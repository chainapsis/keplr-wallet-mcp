#!/usr/bin/env node
/**
 * Google Authenticator (TOTP) test script
 *
 * Usage:
 *   node test-totp.mjs setup          # 1. Start setup (generate key)
 *   node test-totp.mjs verify 123456  # 2. Verify code (complete setup)
 *   node test-totp.mjs status         # 3. Check status
 *   node test-totp.mjs auth 123456    # 4. Test authentication
 *   node test-totp.mjs disable        # 5. Disable
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTotpProvider } from "../packages/server/dist/auth/providers/totp.js";

// Pending setup save file for testing (in production, kept in memory)
const PENDING_SETUP_FILE = path.join(
  os.tmpdir(),
  "keplr-totp-pending-setup.json",
);

const provider = createTotpProvider("google");
const command = process.argv[2];
const code = process.argv[3];

// For testing: restore pending setup
function loadPendingSetup() {
  try {
    if (fs.existsSync(PENDING_SETUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(PENDING_SETUP_FILE, "utf-8"));
      // Check if within 10 minutes
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

// For testing: save pending setup
function savePendingSetup() {
  // @ts-expect-error - private property access for testing
  const setup = provider.pendingSetup;
  if (setup) {
    fs.writeFileSync(PENDING_SETUP_FILE, JSON.stringify(setup));
  }
}

// For testing: clear pending setup
function clearPendingSetup() {
  try {
    fs.unlinkSync(PENDING_SETUP_FILE);
  } catch {
    // ignore
  }
}

async function main() {
  console.log("\n🔐 Google Authenticator Test\n");
  console.log("━".repeat(60));

  switch (command) {
    case "setup": {
      console.log("📱 Step 1: Starting Google Authenticator setup\n");

      const result = await provider.setup({ account: "my-wallet" });

      // For testing: save state
      savePendingSetup();

      if (result.success) {
        console.log("✅ Setup started!\n");

        console.log("📱 Add manually in the Google Authenticator app:");
        console.log("━".repeat(60));
        result.data.manualSetupInstructions.forEach((step) => {
          console.log(`   ${step}`);
        });
        console.log("━".repeat(60));

        console.log(`\n🔑 Setup key: ${result.data.manualEntryKey}`);
        console.log(`⏰ Expires in: ${result.data.expiresIn}`);

        console.log("\n📝 Next steps:");
        console.log(
          `   Once the code appears in the app: node test-totp.mjs verify <6-digit-code>`,
        );

        console.log(
          "\n💡 Note: A QR code URL is also provided, but most QR sites",
        );
        console.log(
          "   don't support the otpauth:// format. Manual entry is recommended.",
        );
      } else {
        console.log("❌ Setup failed:", result.error);
      }
      break;
    }

    case "verify": {
      if (!code) {
        console.log("❌ Please enter a 6-digit code!");
        console.log("   Example: node test-totp.mjs verify 123456");
        break;
      }

      // For testing: restore state
      const hasSetup = loadPendingSetup();
      if (!hasSetup) {
        console.log("❌ No pending setup found.");
        console.log("   Run first: node test-totp.mjs setup");
        break;
      }

      console.log(`📱 Step 2: Verifying code... (${code})\n`);

      const result = await provider.verifySetup(code);

      if (result.success) {
        clearPendingSetup();
        console.log("✅ Setup complete!\n");
        console.log("🎉 Google Authenticator has been activated!");
        console.log("\nCheck status with:");
        console.log("   node test-totp.mjs status");
        console.log("\nTest authentication:");
        console.log("   node test-totp.mjs auth <6-digit-code>");
      } else {
        console.log("❌ Verification failed:", result.error);
        console.log("\n💡 Tips:");
        console.log(
          "   - Codes refresh every 30 seconds. Try again with a new code.",
        );
        console.log("   - Make sure the key registered in the app is correct.");
      }
      break;
    }

    case "status": {
      console.log("📊 Checking current status...\n");

      const status = await provider.getStatus();

      console.log("Google Authenticator Status:");
      console.log("━".repeat(40));
      console.log(`  Enabled: ${status.enabled ? "✅ Yes" : "❌ No"}`);
      console.log(`  Configured: ${status.configured ? "✅ Yes" : "❌ No"}`);
      console.log(
        `  Setup in progress: ${status.setupInProgress ? "⏳ Yes" : "❌ No"}`,
      );
      if (status.authenticatorType) {
        console.log(`  App type: ${status.authenticatorType}`);
      }
      if (status.verifiedAt) {
        console.log(`  Verified at: ${status.verifiedAt}`);
      }

      if (!status.enabled && !status.configured) {
        console.log("\n💡 To set up: node test-totp.mjs setup");
      }
      break;
    }

    case "auth": {
      if (!code) {
        console.log("❌ Please enter a 6-digit code!");
        console.log("   Example: node test-totp.mjs auth 123456");
        break;
      }

      console.log(`🔑 Testing authentication... (${code})\n`);

      const result = await provider.verifyCode(code);

      if (result.success) {
        console.log("✅ Authentication successful!");
        console.log("\n🎉 You can now execute transactions.");
      } else {
        console.log("❌ Authentication failed:", result.error);
      }
      break;
    }

    case "disable": {
      console.log("🗑️ Disabling Google Authenticator...\n");

      await provider.disable();
      clearPendingSetup();

      console.log("✅ Disabled successfully!");
      console.log("\n⚠️  Remember to also delete this account from your app.");
      console.log("\nTo set up again:");
      console.log("   node test-totp.mjs setup");
      break;
    }

    default: {
      console.log("Usage:\n");
      console.log("  node test-totp.mjs setup          # 1. Start setup");
      console.log("  node test-totp.mjs verify 123456  # 2. Verify code");
      console.log("  node test-totp.mjs status         # 3. Check status");
      console.log(
        "  node test-totp.mjs auth 123456    # 4. Test authentication",
      );
      console.log("  node test-totp.mjs disable        # 5. Disable");
    }
  }

  console.log("\n");
}

main().catch(console.error);
