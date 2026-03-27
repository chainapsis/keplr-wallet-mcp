/**
 * Biometric Authentication CLI Tool for macOS
 *
 * This tool provides Touch ID/Face ID protected P-256 key management
 * for the Keplr MCP Server, enabling passkey-style smart account authentication.
 *
 * Usage:
 *   biometric-auth check                          Check if biometric auth is available
 *   biometric-auth auth "reason"                  Authenticate with biometric
 *   biometric-auth register --rp-id <id> --rp-name <name> --user-id <base64url> --user-name <name> --challenge <base64url>
 *   biometric-auth assert --credential-id <base64url> --challenge <base64url> [--rp-id <id>]
 *
 * Exit codes:
 *   0 - Success
 *   1 - Authentication failed / cancelled
 *   2 - Biometric not available
 *   3 - Invalid arguments
 *   4 - Keychain error
 */

import Foundation
import LocalAuthentication
import Security
import CommonCrypto

// MARK: - Constants

let kKeychainServiceName = "com.keplr.mcp.passkey"
let kCredentialPrefix = "credential:"
let kVaultServiceName = "com.keplr.mcp.vault"

// MARK: - Base64URL Encoding/Decoding

extension Data {
    func base64URLEncoded() -> String {
        return self.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // Add padding if needed
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }

        self.init(base64Encoded: base64)
    }
}

// MARK: - Biometric Check

func checkAvailability() -> Bool {
    let context = LAContext()
    var error: NSError?
    return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
}

func getBiometricType() -> String {
    let context = LAContext()
    var error: NSError?

    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
        return "none"
    }

    switch context.biometryType {
    case .touchID: return "touchID"
    case .faceID: return "faceID"
    case .opticID: return "opticID"
    case .none: return "none"
    @unknown default: return "unknown"
    }
}

// MARK: - Device Owner Authentication (Biometric + Password)
//
// Used by vault operations. `.deviceOwnerAuthentication` shows Touch ID first,
// then falls back to system password automatically. Works on Macs without Touch ID.

func checkDeviceOwnerAvailability() -> Bool {
    let context = LAContext()
    var error: NSError?
    return context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
}

func authenticateDeviceOwner(reason: String) async -> Bool {
    let context = LAContext()
    context.localizedCancelTitle = "Cancel"

    do {
        return try await context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: reason
        )
    } catch let error as LAError {
        switch error.code {
        case .userCancel: fputs("error:cancelled\n", stderr)
        case .authenticationFailed: fputs("error:failed\n", stderr)
        default: fputs("error:\(error.localizedDescription)\n", stderr)
        }
        return false
    } catch {
        fputs("error:\(error.localizedDescription)\n", stderr)
        return false
    }
}

// MARK: - Biometric-Only Authentication (WebAuthn / Passkeys)

func authenticate(reason: String) async -> Bool {
    let context = LAContext()
    context.localizedCancelTitle = "Cancel"

    do {
        return try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        )
    } catch let error as LAError {
        switch error.code {
        case .userCancel: fputs("error:cancelled\n", stderr)
        case .userFallback: fputs("error:fallback\n", stderr)
        case .authenticationFailed: fputs("error:failed\n", stderr)
        case .biometryNotAvailable: fputs("error:not_available\n", stderr)
        case .biometryNotEnrolled: fputs("error:not_enrolled\n", stderr)
        case .biometryLockout: fputs("error:lockout\n", stderr)
        default: fputs("error:\(error.localizedDescription)\n", stderr)
        }
        return false
    } catch {
        fputs("error:\(error.localizedDescription)\n", stderr)
        return false
    }
}

// MARK: - WebAuthn-style Credential Management

struct RegistrationOptions {
    let rpId: String
    let rpName: String
    let userId: Data
    let userName: String
    let challenge: Data
}

struct AssertionOptions {
    let credentialId: Data
    let challenge: Data
    let rpId: String?
}

struct RegistrationResult {
    let credentialId: Data
    let publicKey: Data
    let attestationObject: Data
    let clientDataJSON: Data
}

struct AssertionResult {
    let signature: Data
    let authenticatorData: Data
    let clientDataJSON: Data
}

/// Create a P-256 key in Keychain (Touch ID required at signing time)
func createCredential(options: RegistrationOptions) async throws -> RegistrationResult {
    // First, verify biometric is available and authenticate
    guard checkAvailability() else {
        throw NSError(domain: "BiometricAuth", code: 2, userInfo: [NSLocalizedDescriptionKey: "Biometric not available"])
    }

    let authSuccess = await authenticate(reason: "Create passkey for \(options.userName)")
    guard authSuccess else {
        throw NSError(domain: "BiometricAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "cancelled"])
    }

    // Generate credential ID (random 32 bytes)
    var credentialIdBytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, credentialIdBytes.count, &credentialIdBytes) == errSecSuccess else {
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to generate credential ID"])
    }
    let credentialId = Data(credentialIdBytes)

    // Key generation attributes (software key, accessible when unlocked)
    let tag = "\(kKeychainServiceName).\(credentialId.base64URLEncoded())"
    let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAttrLabel as String: "\(options.userName)@\(options.rpId)"
        ]
    ]

    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
        let errMsg = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to create key: \(errMsg)"])
    }

    return try finalizeRegistration(privateKey: privateKey, credentialId: credentialId, options: options)
}

func finalizeRegistration(privateKey: SecKey, credentialId: Data, options: RegistrationOptions) throws -> RegistrationResult {
    // Get public key
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to get public key"])
    }

    var error: Unmanaged<CFError>?
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
        let errMsg = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to export public key: \(errMsg)"])
    }

    // Build clientDataJSON
    let clientData: [String: Any] = [
        "type": "webauthn.create",
        "challenge": options.challenge.base64URLEncoded(),
        "origin": "https://\(options.rpId)",
        "crossOrigin": false
    ]
    let clientDataJSON = try JSONSerialization.data(withJSONObject: clientData)

    // Build attestation object (simplified - none attestation)
    // authData: rpIdHash (32) + flags (1) + signCount (4) + attestedCredData
    var authData = Data()

    // RP ID hash (SHA256)
    let rpIdData = options.rpId.data(using: .utf8)!
    var rpIdHash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    rpIdData.withUnsafeBytes { ptr in
        _ = CC_SHA256(ptr.baseAddress, CC_LONG(rpIdData.count), &rpIdHash)
    }
    authData.append(contentsOf: rpIdHash)

    // Flags: UP (0x01) + UV (0x04) + AT (0x40) = 0x45
    authData.append(0x45)

    // Sign count (4 bytes, big endian)
    authData.append(contentsOf: [0x00, 0x00, 0x00, 0x00])

    // Attested credential data
    // AAGUID (16 bytes, zeros for software authenticator)
    authData.append(contentsOf: [UInt8](repeating: 0, count: 16))

    // Credential ID length (2 bytes, big endian)
    authData.append(UInt8((credentialId.count >> 8) & 0xFF))
    authData.append(UInt8(credentialId.count & 0xFF))

    // Credential ID
    authData.append(credentialId)

    // Public key in COSE format
    let coseKey = buildCOSEKey(publicKeyData: publicKeyData)
    authData.append(coseKey)

    // Attestation object (CBOR map with fmt, attStmt, authData)
    let attestationObject = buildAttestationObject(authData: authData)

    // Store credential metadata in keychain
    try storeCredentialMetadata(credentialId: credentialId, rpId: options.rpId, userName: options.userName)

    return RegistrationResult(
        credentialId: credentialId,
        publicKey: publicKeyData,
        attestationObject: attestationObject,
        clientDataJSON: clientDataJSON
    )
}

/// Build COSE key format for P-256 public key
func buildCOSEKey(publicKeyData: Data) -> Data {
    // publicKeyData is in ANSI X9.63 format: 0x04 || x || y (65 bytes)
    guard publicKeyData.count == 65, publicKeyData[0] == 0x04 else {
        return Data()
    }

    let x = publicKeyData[1...32]
    let y = publicKeyData[33...64]

    // COSE key: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
    // kty: 2 (EC), alg: -7 (ES256), crv: 1 (P-256)
    var cose = Data()
    cose.append(0xA5) // Map of 5 elements
    cose.append(0x01); cose.append(0x02) // kty: EC (2)
    cose.append(0x03); cose.append(0x26) // alg: ES256 (-7 = 0x26 in CBOR)
    cose.append(0x20); cose.append(0x01) // crv: P-256 (1), -1 = 0x20
    cose.append(0x21); cose.append(0x58); cose.append(0x20); cose.append(contentsOf: x) // x
    cose.append(0x22); cose.append(0x58); cose.append(0x20); cose.append(contentsOf: y) // y

    return cose
}

/// Build attestation object
func buildAttestationObject(authData: Data) -> Data {
    // {"fmt": "none", "attStmt": {}, "authData": authData}
    var cbor = Data()
    cbor.append(0xA3) // Map of 3 elements

    // fmt: "none"
    cbor.append(0x63); cbor.append(contentsOf: "fmt".utf8) // text(3) "fmt"
    cbor.append(0x64); cbor.append(contentsOf: "none".utf8) // text(4) "none"

    // attStmt: {}
    cbor.append(0x67); cbor.append(contentsOf: "attStmt".utf8) // text(7) "attStmt"
    cbor.append(0xA0) // empty map

    // authData: bytes
    cbor.append(0x68); cbor.append(contentsOf: "authData".utf8) // text(8) "authData"
    if authData.count <= 23 {
        cbor.append(0x40 + UInt8(authData.count))
    } else if authData.count <= 255 {
        cbor.append(0x58)
        cbor.append(UInt8(authData.count))
    } else {
        cbor.append(0x59)
        cbor.append(UInt8((authData.count >> 8) & 0xFF))
        cbor.append(UInt8(authData.count & 0xFF))
    }
    cbor.append(authData)

    return cbor
}

/// Store credential metadata
func storeCredentialMetadata(credentialId: Data, rpId: String, userName: String) throws {
    let metadata: [String: Any] = [
        "rpId": rpId,
        "userName": userName,
        "createdAt": Date().timeIntervalSince1970
    ]
    let metadataData = try JSONSerialization.data(withJSONObject: metadata)

    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kKeychainServiceName,
        kSecAttrAccount as String: credentialId.base64URLEncoded(),
        kSecValueData as String: metadataData
    ]

    // Delete existing if present
    SecItemDelete(query as CFDictionary)

    let status = SecItemAdd(query as CFDictionary, nil)
    if status != errSecSuccess && status != errSecDuplicateItem {
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to store metadata: \(status)"])
    }
}

/// Get assertion (sign with credential)
func getAssertion(options: AssertionOptions) async throws -> AssertionResult {
    // First, verify biometric and authenticate
    guard checkAvailability() else {
        throw NSError(domain: "BiometricAuth", code: 2, userInfo: [NSLocalizedDescriptionKey: "Biometric not available"])
    }

    let authSuccess = await authenticate(reason: "Sign transaction")
    guard authSuccess else {
        throw NSError(domain: "BiometricAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "cancelled"])
    }

    let tag = "\(kKeychainServiceName).\(options.credentialId.base64URLEncoded())"

    // Query for private key
    let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
        kSecReturnRef as String: true
    ]

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    guard status == errSecSuccess, let privateKey = result else {
        if status == errSecItemNotFound {
            throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Credential not found"])
        }
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to get key: \(status)"])
    }

    // Build clientDataJSON
    let rpId = options.rpId ?? "keplr.local"
    let clientData: [String: Any] = [
        "type": "webauthn.get",
        "challenge": options.challenge.base64URLEncoded(),
        "origin": "https://\(rpId)",
        "crossOrigin": false
    ]
    let clientDataJSON = try JSONSerialization.data(withJSONObject: clientData)

    // Build authenticator data
    var authData = Data()

    // RP ID hash
    let rpIdData = rpId.data(using: .utf8)!
    var rpIdHash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    rpIdData.withUnsafeBytes { ptr in
        _ = CC_SHA256(ptr.baseAddress, CC_LONG(rpIdData.count), &rpIdHash)
    }
    authData.append(contentsOf: rpIdHash)

    // Flags: UP (0x01) + UV (0x04) = 0x05
    authData.append(0x05)

    // Sign count (4 bytes)
    authData.append(contentsOf: [0x00, 0x00, 0x00, 0x01])

    // Hash clientDataJSON
    var clientDataHash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    clientDataJSON.withUnsafeBytes { ptr in
        _ = CC_SHA256(ptr.baseAddress, CC_LONG(clientDataJSON.count), &clientDataHash)
    }

    // Sign authData || clientDataHash
    var signedData = authData
    signedData.append(contentsOf: clientDataHash)

    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
        privateKey as! SecKey,
        .ecdsaSignatureMessageX962SHA256,
        signedData as CFData,
        &error
    ) as Data? else {
        let errMsg = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
        if errMsg.contains("cancel") || errMsg.contains("user") {
            throw NSError(domain: "BiometricAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: "cancelled"])
        }
        throw NSError(domain: "BiometricAuth", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to sign: \(errMsg)"])
    }

    return AssertionResult(
        signature: signature,
        authenticatorData: authData,
        clientDataJSON: clientDataJSON
    )
}

// MARK: - Vault Key Management
//
// Note: kSecAttrAccessControl with .userPresence requires entitlements not available
// to ad-hoc signed binaries (-34018 errSecMissingEntitlement). Instead, we use a
// two-step approach: authenticate via LAContext first, then access a standard
// Keychain item. The Touch ID gate is enforced by this binary, not the Keychain.

func storeVaultKey(account: String, data: Data) -> Int32 {
    let deleteQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kVaultServiceName,
        kSecAttrAccount as String: account,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    let addQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kVaultServiceName,
        kSecAttrAccount as String: account,
        kSecValueData as String: data,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]

    let status = SecItemAdd(addQuery as CFDictionary, nil)
    if status != errSecSuccess {
        fputs("error:keychain_add_failed:\(status)\n", stderr)
        return 4
    }
    return 0
}

func checkVaultKeyExists(account: String) -> Int32 {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kVaultServiceName,
        kSecAttrAccount as String: account,
        kSecReturnAttributes as String: true,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    switch status {
    case errSecSuccess:
        return 0
    case errSecItemNotFound:
        return 1
    default:
        fputs("error:keychain_check_failed:\(status)\n", stderr)
        return 4
    }
}

func retrieveVaultKeyData(account: String) -> Data? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kVaultServiceName,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    switch status {
    case errSecSuccess:
        return result as? Data
    case errSecItemNotFound:
        return nil
    default:
        fputs("error:keychain_get_failed:\(status)\n", stderr)
        return nil
    }
}

func deleteVaultKey(account: String) -> Int32 {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kVaultServiceName,
        kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound {
        return 0
    }
    fputs("error:keychain_delete_failed:\(status)\n", stderr)
    return 4
}

// MARK: - Argument Parsing

func parseArgs(_ args: [String]) -> [String: String] {
    var result: [String: String] = [:]
    var i = 0
    while i < args.count {
        let arg = args[i]
        if arg.hasPrefix("--") {
            let key = String(arg.dropFirst(2))
            if i + 1 < args.count && !args[i + 1].hasPrefix("--") {
                result[key] = args[i + 1]
                i += 2
            } else {
                result[key] = "true"
                i += 1
            }
        } else {
            i += 1
        }
    }
    return result
}

// MARK: - Main

@main
struct BiometricAuthCLI {
    static func main() async {
        let args = CommandLine.arguments

        guard args.count >= 2 else {
            fputs("Usage: biometric-auth <check|auth|register|assert|vault-store|vault-retrieve|vault-delete|vault-check> [options]\n", stderr)
            exit(3)
        }

        let command = args[1]
        let options = parseArgs(Array(args.dropFirst(2)))

        switch command {
        case "check":
            let checkDeviceOwner = options["device-owner"] == "true"
            if checkDeviceOwner {
                // deviceOwnerAuthentication: biometric OR system password
                if checkDeviceOwnerAvailability() {
                    let biometryType = checkAvailability() ? getBiometricType() : "password"
                    print("available:\(biometryType)")
                    exit(0)
                } else {
                    print("unavailable")
                    exit(2)
                }
            } else {
                // deviceOwnerAuthenticationWithBiometrics: biometric-only
                if checkAvailability() {
                    let biometryType = getBiometricType()
                    print("available:\(biometryType)")
                    exit(0)
                } else {
                    print("unavailable")
                    exit(2)
                }
            }

        case "auth":
            let reason = options["reason"] ?? args.dropFirst(2).first(where: { !$0.hasPrefix("--") }) ?? "Authenticate to continue"
            let useDeviceOwner = options["device-owner"] == "true"

            if useDeviceOwner {
                // deviceOwnerAuthentication: Touch ID → system password fallback (works in clamshell)
                guard checkDeviceOwnerAvailability() else {
                    fputs("error:Device authentication not available\n", stderr)
                    exit(2)
                }
                let success = await authenticateDeviceOwner(reason: reason)
                if success {
                    print("success")
                    exit(0)
                } else {
                    exit(1)
                }
            } else {
                // deviceOwnerAuthenticationWithBiometrics: biometric-only (WebAuthn / Passkeys)
                guard checkAvailability() else {
                    fputs("error:Biometric authentication not available\n", stderr)
                    exit(2)
                }
                let success = await authenticate(reason: reason)
                if success {
                    print("success")
                    exit(0)
                } else {
                    exit(1)
                }
            }

        case "register":
            guard let rpId = options["rp-id"],
                  let rpName = options["rp-name"],
                  let userIdStr = options["user-id"],
                  let userName = options["user-name"],
                  let challengeStr = options["challenge"],
                  let userId = Data(base64URLEncoded: userIdStr),
                  let challenge = Data(base64URLEncoded: challengeStr) else {
                fputs("Missing required options for register\n", stderr)
                fputs("Required: --rp-id --rp-name --user-id --user-name --challenge\n", stderr)
                exit(3)
            }

            guard checkAvailability() else {
                fputs("error:not_available\n", stderr)
                exit(2)
            }

            do {
                let regOptions = RegistrationOptions(
                    rpId: rpId,
                    rpName: rpName,
                    userId: userId,
                    userName: userName,
                    challenge: challenge
                )
                let result = try await createCredential(options: regOptions)

                let output: [String: String] = [
                    "credentialId": result.credentialId.base64URLEncoded(),
                    "publicKey": result.publicKey.base64URLEncoded(),
                    "attestationObject": result.attestationObject.base64URLEncoded(),
                    "clientDataJSON": result.clientDataJSON.base64URLEncoded()
                ]
                let jsonData = try JSONSerialization.data(withJSONObject: output)
                print(String(data: jsonData, encoding: .utf8)!)
                exit(0)
            } catch {
                fputs("error:\(error.localizedDescription)\n", stderr)
                exit(4)
            }

        case "assert":
            guard let credentialIdStr = options["credential-id"],
                  let challengeStr = options["challenge"],
                  let credentialId = Data(base64URLEncoded: credentialIdStr),
                  let challenge = Data(base64URLEncoded: challengeStr) else {
                fputs("Missing required options for assert\n", stderr)
                fputs("Required: --credential-id --challenge [--rp-id]\n", stderr)
                exit(3)
            }

            do {
                let assertOptions = AssertionOptions(
                    credentialId: credentialId,
                    challenge: challenge,
                    rpId: options["rp-id"]
                )
                let result = try await getAssertion(options: assertOptions)

                let output: [String: String] = [
                    "signature": result.signature.base64URLEncoded(),
                    "authenticatorData": result.authenticatorData.base64URLEncoded(),
                    "clientDataJSON": result.clientDataJSON.base64URLEncoded()
                ]
                let jsonData = try JSONSerialization.data(withJSONObject: output)
                print(String(data: jsonData, encoding: .utf8)!)
                exit(0)
            } catch let error as NSError {
                if error.code == 1 {
                    fputs("error:cancelled\n", stderr)
                    exit(1)
                }
                fputs("error:\(error.localizedDescription)\n", stderr)
                exit(4)
            }

        case "vault-store":
            guard args.count >= 4 else {
                fputs("Usage: biometric-auth vault-store <account> <base64-data> [--skip-auth]\n", stderr)
                exit(3)
            }
            guard let data = Data(base64Encoded: args[3]) else {
                fputs("error:invalid_base64\n", stderr)
                exit(3)
            }
            if !args.contains("--skip-auth") {
                // Authenticate before storing vault key (Touch ID → system password fallback).
                guard checkDeviceOwnerAvailability() else {
                    fputs("error:biometric_unavailable\n", stderr)
                    exit(2)
                }
                let authOkStore = await authenticateDeviceOwner(reason: "Keplr MCP: store vault key")
                guard authOkStore else { exit(1) }
            }
            exit(storeVaultKey(account: args[2], data: data))

        case "vault-retrieve":
            guard args.count >= 3 else {
                fputs("Usage: biometric-auth vault-retrieve <account> [reason] [--skip-auth]\n", stderr)
                exit(3)
            }
            let skipAuthRetrieve = args.contains("--skip-auth")
            let reason = args.count >= 4 && args[3] != "--skip-auth" ? args[3] : "Keplr MCP: unlock wallet"
            if !skipAuthRetrieve {
                // Authenticate before reading Keychain item (Touch ID → system password fallback).
                guard checkDeviceOwnerAvailability() else {
                    fputs("error:biometric_unavailable\n", stderr)
                    exit(2)
                }
                let authOk = await authenticateDeviceOwner(reason: reason)
                guard authOk else {
                    exit(1) // cancelled or failed
                }
            }
            if let data = retrieveVaultKeyData(account: args[2]) {
                print(data.base64EncodedString())
                exit(0)
            } else {
                exit(1)
            }

        case "vault-delete":
            guard args.count >= 3 else {
                fputs("Usage: biometric-auth vault-delete <account> [--skip-auth]\n", stderr)
                exit(3)
            }
            if !args.contains("--skip-auth") {
                // Authenticate before deleting vault key (Touch ID → system password fallback).
                guard checkDeviceOwnerAvailability() else {
                    fputs("error:biometric_unavailable\n", stderr)
                    exit(2)
                }
                let authOkDelete = await authenticateDeviceOwner(reason: "Keplr MCP: delete vault key")
                guard authOkDelete else { exit(1) }
            }
            exit(deleteVaultKey(account: args[2]))

        case "vault-check":
            guard args.count == 3 else {
                fputs("Usage: biometric-auth vault-check <account>\n", stderr)
                exit(3)
            }
            let checkResult = checkVaultKeyExists(account: args[2])
            if checkResult == 0 {
                print("exists")
            }
            exit(checkResult)

        default:
            fputs("Unknown command: \(command)\n", stderr)
            fputs("Usage: biometric-auth <check|auth|register|assert|vault-store|vault-retrieve|vault-delete|vault-check> [options]\n", stderr)
            exit(3)
        }
    }
}
