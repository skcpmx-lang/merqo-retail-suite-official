/**
 * MERQO Retail Suite — Windows code-signing router (electron-builder custom sign hook).
 *
 * electron-builder invokes this for EVERY Windows PE it would sign, in the correct
 * order: the application exe during packaging, then the NSIS uninstaller, then the
 * final installer. Nothing is modified after signing (electron-builder does not
 * touch a file again once it is signed).
 *
 * Signing identity selection (first match wins) — all secrets come from the CI
 * environment / GitHub Actions secrets. NOTHING is committed to the repository:
 *
 *  1. Azure Key Vault certificate (recommended production route for MERQO):
 *       AZURE_KEY_VAULT_URI   https://<vault-name>.vault.azure.net
 *       AZURE_TENANT_ID       Entra ID tenant
 *       AZURE_CLIENT_ID       app registration (client) id
 *       AZURE_CLIENT_SECRET   client secret
 *       AZURE_CERT_NAME       certificate name in the Key Vault
 *     → signs with AzureSignTool (`azuresigntool`, installed on the runner).
 *       Works with an OV code-signing certificate whose private key lives in the
 *       organization's own Azure Key Vault — available worldwide, incl. Bangladesh.
 *
 *  2. File-based PFX (legacy CAs / internal testing only):
 *       WIN_CSC_LINK          base64 (or path) of the .pfx
 *       WIN_CSC_KEY_PASSWORD  pfx password
 *     → signs with signtool.exe.
 *
 *  3. No identity configured → file is left UNSIGNED with an explicit warning.
 *     RC/dev builds run this way; production releases MUST configure route 1 or 2.
 *
 * Digest: SHA-256 only. Timestamp: RFC-3161 (DigiCert) — signatures remain valid
 * after the certificate expires.
 */
'use strict'

const { execFileSync } = require('node:child_process')

const RFC3161 = process.env.WIN_TIMESTAMP_URL || 'http://timestamp.digicert.com'
const DESCRIPTION = 'MERQO Retail Suite — বাংলাদেশের রিটেইল ব্যবস্থাপনা'

function hasAzureKeyVault() {
  return !!(process.env.AZURE_KEY_VAULT_URI && process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_CERT_NAME)
}
function hasPfx() {
  return !!process.env.WIN_CSC_LINK
}

async function signTask(config) {
  const file = config.path
  if (!file || typeof file !== 'string' || !/\.exe$/i.test(file)) return

  if (hasAzureKeyVault()) {
    // AzureSignTool is installed by the CI workflow (dotnet tool). If it is missing
    // here (local run), fail loudly — a half-signed production tree must never ship.
    console.log(`[sign] Azure Key Vault → ${file}`)
    execFileSync('azuresigntool', [
      'sign',
      '-kvu', process.env.AZURE_KEY_VAULT_URI,
      '-kvt', process.env.AZURE_TENANT_ID,
      '-kc', process.env.AZURE_CERT_NAME,
      '-kvi', process.env.AZURE_CLIENT_ID,
      '-kvs', process.env.AZURE_CLIENT_SECRET,
      '-tr', RFC3161,
      '-td', 'sha256',
      '-fd', 'sha256',
      '-d', DESCRIPTION,
      '-du', 'https://github.com/skcpmx-lang/merqo-retail-suite-official',
      file
    ], { stdio: 'inherit' })
    return
  }

  if (hasPfx()) {
    console.log(`[sign] PFX (signtool) → ${file}`)
    const pfxPath = process.env.WIN_CSC_LINK_PATH || require('node:path').join(require('node:os').tmpdir(), `merqo-sign-${Date.now()}.pfx`)
    if (!process.env.WIN_CSC_LINK_PATH) {
      require('node:fs').writeFileSync(pfxPath, Buffer.from(process.env.WIN_CSC_LINK, 'base64'))
    }
    try {
      // signtool.exe is on PATH on windows-latest runners (Windows SDK)
      execFileSync('signtool', [
        'sign',
        '/f', pfxPath,
        '/p', process.env.WIN_CSC_KEY_PASSWORD || '',
        '/fd', 'sha256',
        '/tr', RFC3161,
        '/td', 'sha256',
        '/d', DESCRIPTION,
        file
      ], { stdio: 'inherit' })
    } finally {
      try { require('node:fs').rmSync(pfxPath, { force: true }) } catch { /* */ }
    }
    return
  }

  console.warn(`[sign] UNSIGNED (no signing identity configured): ${file}`)
}

module.exports = signTask
module.exports.default = signTask
