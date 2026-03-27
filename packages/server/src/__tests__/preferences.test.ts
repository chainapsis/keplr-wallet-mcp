import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config-storage before importing preferences
vi.mock("../config-storage.js", () => ({
  readJsonConfig: vi.fn(),
  writeJsonConfig: vi.fn(),
}));

import { readJsonConfig, writeJsonConfig } from "../config-storage.js";
import {
  dismissWelcome,
  isFirstTimeUser,
  loadPreferences,
  markOnboardingCompleted,
  savePreferences,
  type UserPreferences,
  updatePreference,
} from "../preferences.js";

describe("Preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("loadPreferences", () => {
    it("should return default preferences when no config exists", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      const prefs = await loadPreferences();

      expect(prefs).toEqual({
        version: 1,
        onboardingCompleted: false,
        welcomeDismissed: false,
        showSecurityTips: true,
      });
    });

    it("should load existing preferences", async () => {
      const existingPrefs: UserPreferences = {
        version: 1,
        onboardingCompleted: true,
        onboardingCompletedAt: "2024-01-01T00:00:00.000Z",
        welcomeDismissed: true,
        showSecurityTips: false,
        defaultChain: "osmosis",
      };
      vi.mocked(readJsonConfig).mockResolvedValue(existingPrefs);

      const prefs = await loadPreferences();

      expect(prefs).toEqual(existingPrefs);
    });

    it("should merge with defaults to handle new fields", async () => {
      // Simulating an older config that doesn't have all fields
      const oldPrefs = {
        version: 1,
        onboardingCompleted: true,
      };
      vi.mocked(readJsonConfig).mockResolvedValue(oldPrefs as UserPreferences);

      const prefs = await loadPreferences();

      expect(prefs.onboardingCompleted).toBe(true);
      expect(prefs.welcomeDismissed).toBe(false); // From defaults
      expect(prefs.showSecurityTips).toBe(true); // From defaults
    });
  });

  describe("savePreferences", () => {
    it("should save preferences to config file", async () => {
      const prefs: UserPreferences = {
        version: 1,
        onboardingCompleted: true,
        welcomeDismissed: false,
        showSecurityTips: true,
      };

      await savePreferences(prefs);

      expect(writeJsonConfig).toHaveBeenCalledWith("preferences.json", prefs);
    });
  });

  describe("markOnboardingCompleted", () => {
    it("should set onboardingCompleted to true with timestamp", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      await markOnboardingCompleted();

      expect(writeJsonConfig).toHaveBeenCalled();
      const savedPrefs = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as UserPreferences;
      expect(savedPrefs.onboardingCompleted).toBe(true);
      expect(savedPrefs.onboardingCompletedAt).toBeDefined();
    });
  });

  describe("dismissWelcome", () => {
    it("should set welcomeDismissed to true", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      await dismissWelcome();

      expect(writeJsonConfig).toHaveBeenCalled();
      const savedPrefs = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as UserPreferences;
      expect(savedPrefs.welcomeDismissed).toBe(true);
    });
  });

  describe("isFirstTimeUser", () => {
    it("should return true when onboardingCompleted is false", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      const isFirst = await isFirstTimeUser();

      expect(isFirst).toBe(true);
    });

    it("should return false when onboardingCompleted is true", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        version: 1,
        onboardingCompleted: true,
        welcomeDismissed: false,
        showSecurityTips: true,
      } as UserPreferences);

      const isFirst = await isFirstTimeUser();

      expect(isFirst).toBe(false);
    });
  });

  describe("updatePreference", () => {
    it("should update a specific preference", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue(null);

      await updatePreference("defaultChain", "cosmoshub-4");

      expect(writeJsonConfig).toHaveBeenCalled();
      const savedPrefs = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as UserPreferences;
      expect(savedPrefs.defaultChain).toBe("cosmoshub-4");
    });

    it("should preserve other preferences when updating", async () => {
      vi.mocked(readJsonConfig).mockResolvedValue({
        version: 1,
        onboardingCompleted: true,
        welcomeDismissed: true,
        showSecurityTips: true,
      } as UserPreferences);

      await updatePreference("showSecurityTips", false);

      const savedPrefs = vi.mocked(writeJsonConfig).mock
        .calls[0][1] as UserPreferences;
      expect(savedPrefs.onboardingCompleted).toBe(true);
      expect(savedPrefs.welcomeDismissed).toBe(true);
      expect(savedPrefs.showSecurityTips).toBe(false);
    });
  });
});
