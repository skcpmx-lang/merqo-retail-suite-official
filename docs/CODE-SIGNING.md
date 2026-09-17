# MERQO Retail Suite — Windows 代码签名指南 (Code Signing Guide)
**目的：让 Windows（Smart App Control / SmartScreen / Edge/Chrome 下载警告）认得 MERQO 的发布者身份，客户不需要关闭任何安全设置。**

当前状态：**签名管道已就绪但未激活**（发布者法律身份 + 证书尚未提供）。在签名激活之前，安装程序是未签名的 —— **Windows Smart App Control 会阻止它**。这是当前唯一的商业化分发阻塞项。

---

## 1. 为什么会被阻止（现状）

安装包 `MERQO-Retail-Suite-Setup-1.0.0.exe` 目前**没有任何数字签名**。Smart App Control（Windows 11 默认开启）对无签名/发布者无法验证的应用一律阻止，这是设计行为，不是故障。解决方法只有一个：**用受信任的 CA / 微软支持的签名服务给所有生产二进制签名**。绝不要求客户关闭安全功能。

## 2. 可选方案（已按 MERQO 实际情况核实）

| 方案 | MERQO 可用性（孟加拉国） | 费用 | 说明 |
|---|---|---|---|
| **A. Azure Artifact Signing**（原 Trusted Signing，微软推荐） | ❌ **不可用** — 仅限美国/加拿大/欧盟/英国的组织或个人（个人仅美/加）。除非 MERQO 在上述地区有合法实体 | ~$9.99/月 | 无 USB token，CI 集成最好。**若未来在上述地区设立实体，第一选择** |
| **B. OV 代码签名证书 + 自有 Azure Key Vault**（推荐路线） | ✅ 全球可用 | 证书 ~$150–400/年 + Key Vault 费用极低 | 向 DigiCert/Sectigo/GlobalSign 等购买 OV 证书，私钥放在 MERQO 自己的 Azure Key Vault，CI 用 AzureSignTool 签名。无 USB token、无地域限制、发布者显示为 MERQO 法人名称 |
| **C. CA 云签名服务**（SSL.com eSigner、DigiCert KeyLocker、Certum Cloud 等） | ✅ 全球可用 | ~$200–500/年 | 证书+云 HSM 打包服务，各家有 CI 集成。作为方案 B 的替代 |
| **D. Microsoft Store（MSI/EXE 提交，商店代签）** | ✅ | $19 一次性注册 | 商店安装时无警告；改变分发模式，可日后考虑 |
| EV 证书 | ✅ | $400+/年 | 2024 年起不再有 SmartScreen 即时豁免，性价比低 — 不推荐专门为它买 |
| 自签名/测试证书 | — | — | **禁止用于公开分发**（会被阻止/报警） |

> 注：自 2023 年起，公共信任的代码签名证书私钥必须保存在硬件/云 HSM 中 —— 一般买不到可导出的 .pfx 文件。因此方案 B（Key Vault）或 C（云签名）是现实路线；仓库的签名钩子两条都支持。

## 3. 激活签名 — MERQO 需要提供什么

1. **发布者的确切法律实体名称**（将显示在 Windows"发布者"字段，必须与证书完全一致；例如 `মেরকো ... লিমিটেড` 的英文注册名 / trade license 名称）。**在提供之前，签名不会激活。**
2. 选择方案（建议 **B**）。
3. 方案 B 的具体步骤：
   - 购买 OV 代码签名证书（组织验证：trade license / TIN / 公司注册文件）；
   - Azure Portal 创建 Key Vault + 证书（或按 CA 指引把密钥生成到 Key Vault）；
   - 创建 Entra ID 应用注册（client id + secret），授予 Key Vault **签名单独权限**；
   - 在 GitHub 仓库 **Settings → Secrets and variables → Actions**（建议用受保护的 `production` environment）添加：
     | Secret | 值 |
     |---|---|
     | `AZURE_KEY_VAULT_URI` | `https://<vault>.vault.azure.net` |
     | `AZURE_TENANT_ID` | Entra 租户 ID |
     | `AZURE_CLIENT_ID` | 应用注册 Client ID |
     | `AZURE_CLIENT_SECRET` | Client Secret |
     | `AZURE_CERT_NAME` | Key Vault 证书名 |
   - 下一次 push 即自动签名；CI 会做严格验签（未通过则构建失败）。
4. （替代）若改用 PFX 文件路线：`WIN_CSC_LINK`（base64）+ `WIN_CSC_KEY_PASSWORD`。**任何私钥/密码绝不提交进仓库。**

## 4. 仓库内已实现的机制（本报告对应的工程改动）

- `scripts/sign-win.cjs` — electron-builder 自定义签名钩子：按上面的环境变量自动选择 AzureSignTool / signtool；**SHA-256 + RFC-3161 时间戳**（DigiCert）；无身份时明确警告并不签名。
- electron-builder 在**正确的顺序**调用它：应用 exe（打包时）→ NSIS 卸载程序 → 最终安装程序；签名后不再改动文件（不会破坏签名）。
- CI（windows-installer job）：
  - 构建前清理 `release/`（保证产物名恒为 `MERQO-Retail-Suite-Setup-1.0.0.exe`，禁止 `_2/_3` 后缀）；
  - 签名后用 `Get-AuthenticodeSignature` 验证所有生产 exe（状态、发布者、时间戳），生成 `signature-report.json` 工件；**配置了身份时验签失败即构建失败**；
  - 未配置身份时输出显式 `::warning`（当前状态）。
- 打包冒烟（packaged-smoke）继续在真实 Windows 上安装+启动签名后的 exe，验证签名不破坏启动、原生模块与卸载流程。

## 5. 签名后的现实预期（如实告知）

- **Smart App Control**：有效签名（链到受信任根 + 良好时间戳）即可通过"发布者验证"；不再出现"无法验证发布者"的阻止。
- **SmartScreen/信誉**：新发布者/新文件仍可能短暂出现"更多信息 → 仍要运行"提示，直到微软信誉系统积累信誉。**保持每次发布使用同一证书身份**（不要换证书），信誉会持续累积。
- 客户全程**无需关闭** SmartScreen、Defender 或 Smart App Control。

## 6. 一次性人工验证清单（签名激活后）

1. 下载安装包 → 右键 → 属性 → **数字签名**选项卡：显示 MERQO 法人名称、SHA-256、时间戳；
2. 在开启 Smart App Control 的 Windows 11 上双击安装 → **无阻止对话框**；
3. 安装后启动 → 正常进入 Bengali 首次设置；
4. 卸载 → 卸载程序同样有有效签名。
