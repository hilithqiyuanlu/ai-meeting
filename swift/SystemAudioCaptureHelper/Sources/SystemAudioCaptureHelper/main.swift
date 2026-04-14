import AVFoundation
import AudioToolbox
import CoreAudio
import CoreMedia
import Foundation

enum CaptureBackend: String {
    case none = "none"
    case heuristicApm = "heuristic-apm"
    case systemVoiceProcessing = "system-voice-processing"
}

enum CaptureMode: String {
    case microphone = "microphone"
    case systemAudio = "system-audio"
}

struct AudioDeviceInfo: Encodable {
    let id: String
    let name: String
    let isBlackHole: Bool
}

struct DevicesResponse: Encodable {
    let devices: [AudioDeviceInfo]
}

struct CapabilitiesResponse: Encodable {
    let voiceProcessingSupported: Bool
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

func stringProperty(deviceID: AudioDeviceID, selector: AudioObjectPropertySelector) -> String? {
    var propertyAddress = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = AudioObjectGetPropertyData(deviceID, &propertyAddress, 0, nil, &size, &value)
    guard status == noErr else {
        return nil
    }
    return value as String
}

func audioDeviceIDs() -> [AudioDeviceID] {
    var propertyAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &propertyAddress, 0, nil, &size) == noErr else {
        return []
    }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var deviceIDs = Array(repeating: AudioDeviceID(), count: count)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &propertyAddress, 0, nil, &size, &deviceIDs) == noErr else {
        return []
    }
    return deviceIDs
}

func audioDeviceID(for uid: String) -> AudioDeviceID? {
    audioDeviceIDs().first(where: { stringProperty(deviceID: $0, selector: kAudioDevicePropertyDeviceUID) == uid })
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

final class PCMChunkEmitter: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    private let chunkBytes = 16_000 * 2
    private var converter: AVAudioConverter?
    private var accumulator = Data()

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let sourceBuffer = makePCMBuffer(from: sampleBuffer) else {
            return
        }
        consume(sourceBuffer)
    }

    func consume(_ sourceBuffer: AVAudioPCMBuffer) {
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

func hasVoiceProcessingComponent() -> Bool {
    var description = AudioComponentDescription(
        componentType: kAudioUnitType_Output,
        componentSubType: kAudioUnitSubType_VoiceProcessingIO,
        componentManufacturer: kAudioUnitManufacturer_Apple,
        componentFlags: 0,
        componentFlagsMask: 0
    )
    return AudioComponentFindNext(nil, &description) != nil
}

func supportsVoiceProcessing() -> Bool {
    guard #available(macOS 13.0, *) else {
        return false
    }

    return hasVoiceProcessingComponent()
}

final class RawCaptureRuntime {
    private let session = AVCaptureSession()
    private let delegate = PCMChunkEmitter()
    private let queue = DispatchQueue(label: "ai-meeting.audio.capture.raw")
    private var signalSource: DispatchSourceSignal?

    func start(deviceId: String, backend: CaptureBackend) throws {
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

        installSignalHandler(stopHandler: { [weak self] in
            self?.stop()
            exit(0)
        })

        let backendLabel = backend == .heuristicApm ? "启发式 APM 原始链" : "原始链"
        writeStatus("开始采集设备：\(device.localizedName)（\(backendLabel)）")
        session.startRunning()
        RunLoop.main.run()
    }

    func stop() {
        if session.isRunning {
            session.stopRunning()
        }
        writeStatus("音频采集已停止")
    }

    private func installSignalHandler(stopHandler: @escaping () -> Void) {
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)

        signalSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        signalSource?.setEventHandler(handler: stopHandler)
        signalSource?.resume()
    }
}

@available(macOS 13.0, *)
final class VoiceProcessingCaptureRuntime {
    private let engine = AVAudioEngine()
    private let emitter = PCMChunkEmitter()
    private var signalSource: DispatchSourceSignal?

    func start(deviceId: String) throws {
        guard supportsVoiceProcessing() else {
            throw NSError(domain: "SystemAudioCaptureHelper", code: 10, userInfo: [NSLocalizedDescriptionKey: "系统 Voice Processing 当前不可用"])
        }

        guard let device = AVCaptureDevice.devices(for: .audio).first(where: { $0.uniqueID == deviceId }) else {
            throw NSError(domain: "SystemAudioCaptureHelper", code: 11, userInfo: [NSLocalizedDescriptionKey: "未找到音频设备"])
        }

        if let audioObjectID = audioDeviceID(for: deviceId) {
            try engine.inputNode.auAudioUnit.setDeviceID(audioObjectID)
        }

        try engine.inputNode.setVoiceProcessingEnabled(true)
        let inputFormat = engine.inputNode.outputFormat(forBus: 0)
        engine.inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
            self?.emitter.consume(buffer)
        }

        installSignalHandler(stopHandler: { [weak self] in
            self?.stop()
            exit(0)
        })

        writeStatus("开始采集设备：\(device.localizedName)（系统 Voice Processing）")
        engine.prepare()
        try engine.start()
        RunLoop.main.run()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? engine.inputNode.setVoiceProcessingEnabled(false)
        writeStatus("音频采集已停止")
    }

    private func installSignalHandler(stopHandler: @escaping () -> Void) {
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)

        signalSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        signalSource?.setEventHandler(handler: stopHandler)
        signalSource?.resume()
    }
}

func parseArgument(_ name: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name), arguments.count > index + 1 else {
        return nil
    }
    return arguments[index + 1]
}

let arguments = Array(CommandLine.arguments.dropFirst())

switch arguments.first {
case "devices":
    writeJSON(DevicesResponse(devices: listDevices()))
case "capabilities":
    writeJSON(CapabilitiesResponse(voiceProcessingSupported: supportsVoiceProcessing()))
case "capture":
    guard let deviceId = parseArgument("--device-id", in: arguments) else {
        writeError("缺少 --device-id")
        exit(2)
    }

    let captureMode = CaptureMode(rawValue: parseArgument("--capture-mode", in: arguments) ?? CaptureMode.microphone.rawValue) ?? .microphone
    let backend = CaptureBackend(rawValue: parseArgument("--backend", in: arguments) ?? CaptureBackend.none.rawValue) ?? .none

    do {
        if captureMode == .microphone && backend == .systemVoiceProcessing {
            if #available(macOS 13.0, *) {
                let runtime = VoiceProcessingCaptureRuntime()
                try runtime.start(deviceId: deviceId)
            } else {
                throw NSError(domain: "SystemAudioCaptureHelper", code: 12, userInfo: [NSLocalizedDescriptionKey: "当前系统版本不支持 Voice Processing"])
            }
        } else {
            let runtime = RawCaptureRuntime()
            try runtime.start(deviceId: deviceId, backend: backend)
        }
    } catch {
        writeError(error.localizedDescription)
        exit(1)
    }
default:
    FileHandle.standardError.write(
        Data("Usage: SystemAudioCaptureHelper devices | capabilities | capture --device-id <id> --backend <none|heuristic-apm|system-voice-processing> --capture-mode <microphone|system-audio>\n".utf8)
    )
    exit(2)
}
