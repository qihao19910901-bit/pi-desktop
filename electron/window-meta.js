// window-meta.js - 多窗口账号命名/识别（P2-2 纯逻辑，可测）
const ACCOUNT_PARTITIONS = {
  'persist:account-1': '账号 1',
  'persist:account-2': '账号 2',
  'persist:account-3': '账号 3',
};

function accountLabel(partition) {
  if (!partition) return null;
  return ACCOUNT_PARTITIONS[partition] || null;
}

// 窗口标题 = [账号标签] + 页面标题（页面标题变化时重新组合）
function buildWindowTitle(account, pageTitle) {
  const base = pageTitle && pageTitle.trim() ? pageTitle.trim() : 'Pi Desktop';
  return account ? `${account} - ${base}` : base;
}

// 账号窗口角标（注入页面的状态提示条）
const ACCOUNT_BADGE_HTML = (label) => `
<div id="pi-account-badge" style="position:fixed;top:10px;right:10px;z-index:2147483647;
  background:#cba6f7;color:#1e1e2e;font-size:11px;font-weight:700;padding:3px 10px;
  border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.35);font-family:system-ui;
  letter-spacing:.5px;user-select:none;pointer-events:none;">${label}</div>`;

module.exports = { ACCOUNT_PARTITIONS, accountLabel, buildWindowTitle, ACCOUNT_BADGE_HTML };
