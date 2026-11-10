import CoreNFC
import ExpoModulesCore

/// Lee la tarjeta TuLlave en el teléfono con Core NFC. No interpreta nada: devuelve las respuestas de la tarjeta en
/// hexadecimal (con su estado final) y la lógica de saldo y movimientos vive en `@transmi/domain` (parseTuLlave).
public class TullaveModule: Module {
  private var reader: CardReader?

  public func definition() -> ModuleDefinition {
    Name("Tullave")

    Function("isAvailable") { () -> Bool in
      NFCTagReaderSession.readingAvailable
    }

    AsyncFunction("read") { (prompts: [String: String], promise: Promise) in
      guard NFCTagReaderSession.readingAvailable else {
        promise.reject("unsupported", "Este teléfono no puede leer tarjetas.")
        return
      }
      let reader = CardReader(prompts: prompts) { [weak self] result in
        self?.reader = nil
        switch result {
        case .success(let reading): promise.resolve(reading)
        case .failure(let failure): promise.reject(failure.code, failure.code)
        }
      }
      self.reader = reader
      reader.begin()
    }.runOnQueue(.main)
  }
}

struct ReadFailure: Error { let code: String }

/// Comandos estándar de tarjeta inteligente que entiende la TuLlave.
private enum Command {
  static let selectApp: [UInt8] = [0x00, 0xA4, 0x04, 0x00, 0x07, 0xD4, 0x10, 0x00, 0x00, 0x03, 0x00, 0x01]
  static let balance: [UInt8] = [0x90, 0x4C, 0x00, 0x00, 0x04]
  static let purse: [UInt8] = [0x00, 0xB0, 0x86, 0x00, 0x42]
  static let selectCardFile: [UInt8] = [0x00, 0xA4, 0x00, 0x00, 0x02, 0x42, 0x00]
  static func record(_ n: UInt8) -> [UInt8] { [0x00, 0xB2, n, 0x24, 0x2E] }
}

private typealias Send = (NFCISO7816APDU) async throws -> (Data, UInt8, UInt8)

final class CardReader: NSObject, NFCTagReaderSessionDelegate, @unchecked Sendable {
  private let prompts: [String: String]
  private let finish: (Result<[String: Any], ReadFailure>) -> Void
  private var session: NFCTagReaderSession?
  private var finished = false

  init(prompts: [String: String], finish: @escaping (Result<[String: Any], ReadFailure>) -> Void) {
    self.prompts = prompts
    self.finish = finish
  }

  private func text(_ key: String, _ fallback: String) -> String { prompts[key] ?? fallback }

  func begin() {
    session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
    session?.alertMessage = text("hold", "Acerca la tarjeta a la parte de arriba del teléfono")
    session?.begin()
  }

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    switch (error as? NFCReaderError)?.code {
    case .readerSessionInvalidationErrorUserCanceled: end(.failure(ReadFailure(code: "cancelled")))
    case .readerSessionInvalidationErrorSessionTimeout: end(.failure(ReadFailure(code: "timeout")))
    default: end(.failure(ReadFailure(code: "failed")))
    }
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard let tag = tags.first else { return }
    let send: Send
    switch tag {
    case .iso7816(let card):
      send = { try await card.sendCommand(apdu: $0) }
    case .miFare(let card) where card.mifareFamily == .desfire:
      send = { try await card.sendMiFareISO7816Command($0) }
    default:
      fail(session, "not_tullave", text("notCard", "Esa tarjeta no parece una TuLlave"))
      return
    }

    Task {
      do {
        try await session.connect(to: tag)
        session.alertMessage = text("reading", "Leyendo… no la muevas")
        let reading = try await read(send)
        session.alertMessage = text("done", "Listo")
        session.invalidate()
        end(.success(reading))
      } catch let failure as ReadFailure {
        fail(session, failure.code, text("notCard", "Esa tarjeta no parece una TuLlave"))
      } catch {
        fail(session, "lost", text("lost", "Se perdió la conexión con la tarjeta. Intenta de nuevo"))
      }
    }
  }

  private func read(_ send: Send) async throws -> [String: Any] {
    let app = try await exchange(send, Command.selectApp)
    guard app.hasSuffix("9000") else { throw ReadFailure(code: "not_tullave") }
    let balance = try await exchange(send, Command.balance)
    let purse = try await exchange(send, Command.purse)
    let cardFile = try await exchange(send, Command.selectCardFile)
    var records: [Any] = []
    for n in UInt8(1)...10 {
      records.append((try? await exchange(send, Command.record(n))) ?? NSNull())
    }
    return ["balance": balance, "purse": purse, "cardFile": cardFile, "records": records]
  }

  private func exchange(_ send: Send, _ bytes: [UInt8]) async throws -> String {
    guard let apdu = NFCISO7816APDU(data: Data(bytes)) else { throw ReadFailure(code: "failed") }
    let (data, sw1, sw2) = try await send(apdu)
    return (data + Data([sw1, sw2])).map { String(format: "%02x", $0) }.joined()
  }

  private func fail(_ session: NFCTagReaderSession, _ code: String, _ message: String) {
    session.invalidate(errorMessage: message)
    end(.failure(ReadFailure(code: code)))
  }

  private func end(_ result: Result<[String: Any], ReadFailure>) {
    DispatchQueue.main.async {
      guard !self.finished else { return }
      self.finished = true
      self.session = nil
      self.finish(result)
    }
  }
}
