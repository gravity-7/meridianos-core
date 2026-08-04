/**
 * notarize.js — electron-builder `afterSign` hook, macOS notarization (T101 — placeholder for
 * production). A real release needs Apple Developer credentials in env vars:
 *   APPLE_ID              — the Apple ID email used for the Developer Program
 *   APPLE_ID_PASSWORD      — an app-specific password (NOT the account password)
 *   APPLE_TEAM_ID          — the Developer Team ID
 * Without all three, this is a no-op (logs why and returns) rather than failing the build — so
 * unsigned local/dev builds keep working; only a real release build needs them set.
 */
const { notarize } = (() => {
  try { return require('@electron/notarize'); } catch { return {}; }
})();

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_ID_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[meridianos] Skipping notarization — APPLE_ID/APPLE_ID_PASSWORD/APPLE_TEAM_ID not set (expected for local/dev builds).');
    return;
  }
  if (!notarize) {
    console.log('[meridianos] Skipping notarization — @electron/notarize is not installed. Add it as a devDependency before a real release build.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appBundleId: 'com.meridianos.desktop',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_ID_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log(`[meridianos] Notarized ${appName}.app`);
};
