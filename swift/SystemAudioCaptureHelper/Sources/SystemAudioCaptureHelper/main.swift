import AVFoundation
import CoreMedia
import Foundation

struct AudioDeviceInfo: Encodable {
    let id: String
    let name: String
    let isBlackHole: Bool
}

struct DevicesResponse: Encodable {
    let devices: [AudioDeviceInfo]
}

struct HelperEvent: Encodable {
    let type: String
    let message: String?
    let pcmBase64: String?
}

func writeJSON<T: Encodable>(_ payload: T) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(payload) else {
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func writeStatus(_ message: String) {
    writeJSON(HelperEvent(type: "status", message: message, pcmBase64: nil))
}

func writeError(_ message: String) {
    writeJSON(HelperEvent(type: "error", message: message, pcmBase64: nil))
}

func listDevices() -> [AudioDeviceInfo] {
    AVCaptureDevice.devices(for: .audio).map { device in
        AudioDeviceInfo(
            id: device.uniqueID,
            name: device.localizedName,
            isBlackHole: device.localizedName.localizedCaseInsensitiveContains("blackhole")
        )
    }
}

final class AudioChunkEmitter: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    private let chunkBytes = 16_000 * 2
    private var converter: AVAudioConverter?
    private var accumulator = Data()

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let sourceBuffer = makePCMBuffer(from: sampleBuffer) else {
            return
        }

        if converter == nil || converter?.inputFormat != sourceBuffer.format {
            converter = AVAudioConverter(from: sourceBuffer.format, to: targetFormat)
        }

        guard let converted = convert(sourceBuffer), converted.frameLength > 0 else {
            return
        }

        let audioBuffer = converted.audioBufferList.pointee.mBuffers
        guard let dataPointer = audioBuffer.mData else {
            return
        }

        accumulator.append(Data(bytes: dataPointer, count: Int(audioBuffer.mDataByteSize)))
        while accumulator.count >= chunkBytes {
            let chunk = accumulator.prefix(chunkBytes)
            accumulator.removeFirst(chunkBytes)
            writeJSON(HelperEvent(type: "audio_chunk", message: nil, pcmBase64: chunk.base64EncodedString()))
        }
    }

    private func makePCMBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let streamDescriptionPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return nil
        }

        var streamDescription = streamDescriptionPointer.pointee
        guard let sourceFormat = AVAudioFormat(streamDescription: &streamDescription) else {
            return nil
        }

        let sampleCount = CMSampleBufferGetNumSamples(sampleBuffer)
        let bufferListSize = MemoryLayout<AudioBufferList>.size + MemoryLayout<AudioBuffer>.size * max(0, Int(sourceFormat.channelCount) - 1)
        let audioBufferListPointer = UnsafeMutableRawPointer
            .allocate(byteCount: bufferListSize, alignment: MemoryLayout<AudioBufferList>.alignment)
            .bindMemory(to: AudioBufferList.self, capacity: 1)

        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferListPointer,
            bufferListSize: bufferListSize,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else {
            audioBufferListPointer.deallocate()
            return nil
        }

        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: sourceFormat,
            bufferListNoCopy: UnsafePointer(audioBufferListPointer),
            deallocator: { _ in audioBufferListPointer.deallocate() }
        ) else {
            audioBufferListPointer.deallocate()
            return nil
        }
        buffer.frameLength = AVAudioFrameCount(sampleCount)
        return buffer
    }

    private func convert(_ sourceBuffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter else {
            return nil
        }

        let ratio = targetFormat.sampleRate / sourceBuffer.format.sampleRate
        let frameCapacity = AVAudioFrameCount(Double(sourceBuffer.frameLength) * ratio) + 1024
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity) else {
            return nil
        }

        var didProvideInput = false
        var error: NSError?
        converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            if didProvideInput {
                outStatus.pointee = .noDataNow
                return nil
            }
            didProvideInput = true
            outStatus.pointee = .haveData
            return sourceBuffer
        }

        if let error {
            writeError("音频格式转换失败: \(error.localizedDescription)")
            return nil
        }

        return outputBuffer
    }
}

final class CaptureRuntime {
    private let session = AVCaptureSession()
    private let delegate = AudioChunkEmitter()
    private let queue = DispatchQueue(label: "ai-meeting.audio.capture")
    private var signalSource: DispatchSourceSignal?

    func start(deviceId: String) throws {
        guard let device = AVCaptureDevice.devices(for: .audio).first(where: { $0.uniqueID == deviceId }) else {
            throw NSError(domain: "SystemAudioCaptureHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "未找到音频设备"])
        }

        session.beginConfiguration()

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "SystemAudioCaptureHelper", code: 2, userInfo: [NSLocalizedDescriptionKey: "无法添加音频输入"])
        }
        session.addInput(input)

        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(delegate, queue: queue)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "SystemAudioCaptureHelper", code: 3, userInfo: [NSLocalizedDescriptionKey: "无法添加音频输出"])
        }
        session.addOutput(output)
        session.commitConfiguration()

        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)

        signalSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        signalSource?.setEventHandler { [weak self] in
            self?.stop()
            exit(0)
        }
        signalSource?.resume()

        writeStatus("开始采集设备：\(device.localizedName)")
        session.startRunning()
        RunLoop.main.run()
    }

    func stop() {
        if session.isRunning {
            session.stopRunning()
        }
        writeStatus("音频采集已停止")
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())

switch arguments.first {
case "devices":
    writeJSON(DevicesResponse(devices: listDevices()))
case "capture":
    guard let flagIndex = arguments.firstIndex(of: "--device-id"),
          arguments.count > flagIndex + 1 else {
        writeError("缺少 --device-id")
        exit(2)
    }

    let deviceId = arguments[flagIndex + 1]
    do {
        let runtime = CaptureRuntime()
        try runtime.start(deviceId: deviceId)
    } catch {
        writeError(error.localizedDescription)
        exit(1)
    }
default:
    FileHandle.standardError.write(Data("Usage: SystemAudioCaptureHelper devices | capture --device-id <id>\n".utf8))
    exit(2)
}
