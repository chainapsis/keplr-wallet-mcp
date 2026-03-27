#!/usr/bin/env node
/**
 * Google Authenticator (TOTP) 테스트 스크립트
 *
 * 사용법:
 *   node test-totp.mjs setup          # 1. 설정 시작 (키 생성)
 *   node test-totp.mjs verify 123456  # 2. 코드 검증 (설정 완료)
 *   node test-totp.mjs status         # 3. 상태 확인
 *   node test-totp.mjs auth 123456    # 4. 인증 테스트
 *   node test-totp.mjs disable        # 5. 비활성화
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTotpProvider } from "../packages/server/dist/auth/providers/totp.js";

// 테스트용 pending setup 저장 파일 (실제 서버에서는 메모리에서 유지됨)
const PENDING_SETUP_FILE = path.join(
  os.tmpdir(),
  "keplr-totp-pending-setup.json",
);

const provider = createTotpProvider("google");
const command = process.argv[2];
const code = process.argv[3];

// 테스트용: pending setup 복원
function loadPendingSetup() {
  try {
    if (fs.existsSync(PENDING_SETUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(PENDING_SETUP_FILE, "utf-8"));
      // 10분 이내인지 확인
      if (Date.now() - data.createdAt < 10 * 60 * 1000) {
        // @ts-expect-error - private property access for testing
        provider.pendingSetup = data;
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

// 테스트용: pending setup 저장
function savePendingSetup() {
  // @ts-expect-error - private property access for testing
  const setup = provider.pendingSetup;
  if (setup) {
    fs.writeFileSync(PENDING_SETUP_FILE, JSON.stringify(setup));
  }
}

// 테스트용: pending setup 삭제
function clearPendingSetup() {
  try {
    fs.unlinkSync(PENDING_SETUP_FILE);
  } catch {
    // ignore
  }
}

async function main() {
  console.log("\n🔐 Google Authenticator 테스트\n");
  console.log("━".repeat(60));

  switch (command) {
    case "setup": {
      console.log("📱 Step 1: Google Authenticator 설정 시작\n");

      const result = await provider.setup({ account: "my-wallet" });

      // 테스트용: 상태 저장
      savePendingSetup();

      if (result.success) {
        console.log("✅ 설정 시작됨!\n");

        console.log("📱 Google Authenticator 앱에서 수동으로 추가하세요:");
        console.log("━".repeat(60));
        result.data.manualSetupInstructions.forEach((step) => {
          console.log(`   ${step}`);
        });
        console.log("━".repeat(60));

        console.log(`\n🔑 설정 키: ${result.data.manualEntryKey}`);
        console.log(`⏰ 유효 시간: ${result.data.expiresIn}`);

        console.log("\n📝 다음 단계:");
        console.log(
          `   앱에 코드가 표시되면: node test-totp.mjs verify <6자리코드>`,
        );

        console.log(
          "\n💡 참고: QR 코드 URL도 제공되지만, 대부분의 QR 사이트에서",
        );
        console.log(
          "   otpauth:// 형식을 지원하지 않아요. 수동 입력을 권장합니다.",
        );
      } else {
        console.log("❌ 설정 실패:", result.error);
      }
      break;
    }

    case "verify": {
      if (!code) {
        console.log("❌ 6자리 코드를 입력하세요!");
        console.log("   예: node test-totp.mjs verify 123456");
        break;
      }

      // 테스트용: 상태 복원
      const hasSetup = loadPendingSetup();
      if (!hasSetup) {
        console.log("❌ 진행 중인 설정이 없어요.");
        console.log("   먼저 실행하세요: node test-totp.mjs setup");
        break;
      }

      console.log(`📱 Step 2: 코드 검증 중... (${code})\n`);

      const result = await provider.verifySetup(code);

      if (result.success) {
        clearPendingSetup();
        console.log("✅ 설정 완료!\n");
        console.log("🎉 Google Authenticator가 활성화되었습니다!");
        console.log("\n다음 명령어로 상태를 확인하세요:");
        console.log("   node test-totp.mjs status");
        console.log("\n인증 테스트:");
        console.log("   node test-totp.mjs auth <6자리코드>");
      } else {
        console.log("❌ 검증 실패:", result.error);
        console.log("\n💡 팁:");
        console.log(
          "   - 코드가 30초마다 바뀌어요. 새 코드로 다시 시도해보세요.",
        );
        console.log("   - 앱에 등록한 키가 맞는지 확인하세요.");
      }
      break;
    }

    case "status": {
      console.log("📊 현재 상태 확인 중...\n");

      const status = await provider.getStatus();

      console.log("Google Authenticator 상태:");
      console.log("━".repeat(40));
      console.log(`  활성화: ${status.enabled ? "✅ 예" : "❌ 아니오"}`);
      console.log(`  설정됨: ${status.configured ? "✅ 예" : "❌ 아니오"}`);
      console.log(
        `  설정 진행중: ${status.setupInProgress ? "⏳ 예" : "❌ 아니오"}`,
      );
      if (status.authenticatorType) {
        console.log(`  앱 종류: ${status.authenticatorType}`);
      }
      if (status.verifiedAt) {
        console.log(`  설정 완료일: ${status.verifiedAt}`);
      }

      if (!status.enabled && !status.configured) {
        console.log("\n💡 설정하려면: node test-totp.mjs setup");
      }
      break;
    }

    case "auth": {
      if (!code) {
        console.log("❌ 6자리 코드를 입력하세요!");
        console.log("   예: node test-totp.mjs auth 123456");
        break;
      }

      console.log(`🔑 인증 테스트 중... (${code})\n`);

      const result = await provider.verifyCode(code);

      if (result.success) {
        console.log("✅ 인증 성공!");
        console.log("\n🎉 트랜잭션을 실행할 수 있습니다.");
      } else {
        console.log("❌ 인증 실패:", result.error);
      }
      break;
    }

    case "disable": {
      console.log("🗑️ Google Authenticator 비활성화 중...\n");

      await provider.disable();
      clearPendingSetup();

      console.log("✅ 비활성화 완료!");
      console.log("\n⚠️  앱에서도 해당 계정을 삭제하세요.");
      console.log("\n다시 설정하려면:");
      console.log("   node test-totp.mjs setup");
      break;
    }

    default: {
      console.log("사용법:\n");
      console.log("  node test-totp.mjs setup          # 1. 설정 시작");
      console.log("  node test-totp.mjs verify 123456  # 2. 코드 검증");
      console.log("  node test-totp.mjs status         # 3. 상태 확인");
      console.log("  node test-totp.mjs auth 123456    # 4. 인증 테스트");
      console.log("  node test-totp.mjs disable        # 5. 비활성화");
    }
  }

  console.log("\n");
}

main().catch(console.error);
