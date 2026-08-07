// preload.js - 中文化注入 + 外链拦截
// 运行在渲染进程，隔离环境，DOM 可访问
console.log('========================================');
console.log('[pi-preload] v2026.07.27 LOADED OK');
console.log('========================================');
const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const DICT_FILE = path.join(__dirname, '.devdict.json');

// ============ 中文字典 ============
// pi-web 界面文案英→中映射，遇到新文案持续补充
const ZH_MAP = {
  // 通用
  'Send': '发送',
  'Send Message': '发送消息',
  'New': '新建',
  'New Session': '新建会话',
  'New Chat': '新建对话',
  'Settings': '设置',
  'Cancel': '取消',
  'Save': '保存',
  'Delete': '删除',
  'Remove': '移除',
  'Close': '关闭',
  'Open': '打开',
  'Edit': '编辑',
  'Rename': '重命名',
  'Clear': '清空',
  'Clear All': '全部清空',
  'Copy': '复制',
  'Paste': '粘贴',
  'Cut': '剪切',
  'Select All': '全选',
  'Search': '搜索',
  'Filter': '筛选',
  'Refresh': '刷新',
  'Reload': '重新加载',
  'Loading': '加载中',
  'Loading...': '加载中...',
  'Error': '错误',
  'Warning': '警告',
  'Info': '信息',
  'Success': '成功',
  'Yes': '是',
  'No': '否',
  'OK': '确定',
  'Confirm': '确认',
  'Apply': '应用',
  'Reset': '重置',
  'Continue': '继续',
  'Stop': '停止',
  'Pause': '暂停',
  'Resume': '继续',
  'Retry': '重试',
  'Back': '返回',
  'Next': '下一步',
  'Previous': '上一步',
  'Finish': '完成',
  'Done': '完成',
  'Name': '名称',
  'Description': '描述',
  'Status': '状态',
  'Type': '类型',
  'Size': '大小',
  'Date': '日期',
  'Time': '时间',
  'Path': '路径',
  'File': '文件',
  'Folder': '文件夹',
  'Directory': '目录',
  'Project': '项目',
  'Workspace': '工作区',

  // 会话/对话相关
  'Session': '会话',
  'Sessions': '会话列表',
  'Chat': '对话',
  'Message': '消息',
  'Messages': '消息',
  'History': '历史',
  'Prompt': '提示词',
  'Response': '回复',
  'Assistant': '助手',
  'User': '用户',
  'System': '系统',
  'Model': '模型',
  'Models': '模型',
  'MODELS': '模型',
  'Model Settings': '模型设置',
  'Select Model': '选择模型',
  'No model selected': '未选择模型',
  'Token': 'Token',
  'Tokens': 'Token',

  // 设置类
  'Theme': '主题',
  'Light': '浅色',
  'Dark': '深色',
  'Auto': '跟随系统',
  'Language': '语言',
  'English': '英文',
  'Chinese': '中文',
  'API Key': 'API 密钥',
  'API key': 'API 密钥',
  'Provider': '提供商',
  'Endpoint': '端点',
  'Temperature': '温度',
  'Max Tokens': '最大 Token',
  'Configuration': '配置',
  'General': '通用',
  'Advanced': '高级',
  'About': '关于',
  'Version': '版本',
  'Update': '更新',
  'Check for Updates': '检查更新',
  'Logout': '退出登录',
  'Login': '登录',
  'Sign In': '登录',
  'Sign Out': '退出登录',
  'Account': '账号',

  // 文件操作
  'Upload': '上传',
  'Download': '下载',
  'Export': '导出',
  'Import': '导入',
  'Share': '分享',

  // 状态/提示
  'Connecting...': '连接中...',
  'Disconnected': '已断开',
  'Connected': '已连接',
  'Online': '在线',
  'Offline': '离线',
  'Ready': '就绪',
  'Running': '运行中',
  'Completed': '已完成',
  'Failed': '失败',
  'Pending': '等待中',
  'Idle': '空闲',
  'Active': '活跃',
  'Archived': '已归档',

  // 其他常见
  'Help': '帮助',
  'Documentation': '文档',
  'Feedback': '反馈',
  'Report Issue': '报告问题',
  'Preferences': '偏好设置',
  'Options': '选项',
  'More': '更多',
  'Less': '更少',
  'Expand': '展开',
  'Collapse': '收起',
  'Show': '显示',
  'Hide': '隐藏',
  'Enable': '启用',
  'Disable': '禁用',
  'Enabled': '已启用',
  'Disabled': '已禁用',
  'Required': '必填',
  'Optional': '可选',
  'Default': '默认',
  'Custom': '自定义',
  'Add': '添加',
  'Create': '创建',
  'Update': '更新',
  'Submit': '提交',
  'Accept': '接受',
  'Reject': '拒绝',
  'Approve': '批准',
  'Decline': '拒绝',

  // Pi 特有可能
  'Agent': 'Agent',
  'Agents': 'Agent',
  'Tool': '工具',
  'Tools': '工具',
  'Command': '命令',
  'Terminal': '终端',
  'Console': '控制台',
  'Output': '输出',
  'Input': '输入',
  'Execute': '执行',
  'Run': '运行',
  'Debug': '调试',
  'Build': '构建',
  'Deploy': '部署',
  // 用户反馈补充的 pi-web 实际文案
  'Get Started': '开始使用',
  'SKILL': '技能',
  'Skill': '技能',
  'skills': '技能',
  'Plugins': '插件',
  'plugins': '插件',
  'Plugin': '插件',
  'Select a project directory from the sidebar': '从侧边栏选择项目目录',
  'Add models via the': '通过底部的',
  'button at the bottom': '按钮添加模型',
  'from the sidebar': '从侧边栏',
  'at the bottom': '在底部',
  'Use default directory': '使用默认目录',
  'Custom path': '自定义路径',
  'Chats': '对话',
  'CHATS': '对话',
};

// 占位符文案的中文（{0} 之类）
const ZH_MAP_PLACEHOLDER = {
  'Type a message...': '输入消息...',
  'Type your message...': '输入你的消息...',
  'Enter a prompt...': '输入提示词...',
  'Search...': '搜索...',
  'Filter...': '筛选...',
  'Enter API key...': '输入 API 密钥...',
  'Select project...': '选择项目...',
  'Custom path...': '自定义路径...',
  'Search project...': '搜索项目...',
};

// ============ DOM 文本替换 ============
function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed) return;
    // 精确匹配
    if (ZH_MAP[trimmed]) {
      node.nodeValue = raw.replace(trimmed, ZH_MAP[trimmed]);
      return;
    }
    // 大小写不敏感匹配（兜底）
    const key = Object.keys(ZH_MAP).find(k => k.toLowerCase() === trimmed.toLowerCase());
    if (key) {
      node.nodeValue = raw.replace(trimmed, ZH_MAP[key]);
    }
    return;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    // placeholder 属性（先查 PLACEHOLDER 字典，再回退到主字典，让热重载 .devdict.json 也能覆盖 placeholder）
    if (node.placeholder) {
      if (ZH_MAP_PLACEHOLDER[node.placeholder]) {
        node.placeholder = ZH_MAP_PLACEHOLDER[node.placeholder];
      } else if (ZH_MAP[node.placeholder]) {
        node.placeholder = ZH_MAP[node.placeholder];
      } else {
        const ph = node.placeholder;
        const k1 = Object.keys(ZH_MAP_PLACEHOLDER).find(k => k.toLowerCase() === ph.toLowerCase());
        if (k1) node.placeholder = ZH_MAP_PLACEHOLDER[k1];
        else {
          const k2 = Object.keys(ZH_MAP).find(k => k.toLowerCase() === ph.toLowerCase());
          if (k2) node.placeholder = ZH_MAP[k2];
        }
      }
    }
    // title 属性
    if (node.title && ZH_MAP[node.title]) {
      node.title = ZH_MAP[node.title];
    }
  }
}

function walkAndTranslate(root) {
  // 只处理文本节点和带属性元素，避免递归过深
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null
  );
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(translateNode);
}

// ============ MutationObserver 持续翻译 ============
let observerStarted = false;
function startObserver() {
  if (observerStarted) return;
  observerStarted = true;
  console.log('[Pi Desktop preload] 已注入，字典词数:', Object.keys(ZH_MAP).length, 'readyState:', document.readyState);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          translateNode(n);
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          translateNode(n);
          walkAndTranslate(n);
        }
      });
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // 首次全量翻译
  walkAndTranslate(document.body);
  // 重试几次（pi-web 可能异步渲染）
  setTimeout(() => walkAndTranslate(document.body), 500);
  setTimeout(() => walkAndTranslate(document.body), 1500);
  setTimeout(() => walkAndTranslate(document.body), 3000);

  // ============ 热重载字典（开发用） ============
  // 修改 .devdict.json 后 3 秒自动加载并重新翻译，不用重启 dev
  // 打包后 .devdict.json 不在 asar，fs.existsSync 失败，自动跳过
  setInterval(() => {
    try {
      if (!fs.existsSync(DICT_FILE)) return;
      const extra = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
      let changed = 0;
      for (const [k, v] of Object.entries(extra)) {
        if (ZH_MAP[k] !== v) { ZH_MAP[k] = v; changed++; }
      }
      if (changed) {
        console.log('[preload] 热加载字典:', changed, '词变化');
        walkAndTranslate(document.body);
        setTimeout(() => walkAndTranslate(document.body), 500);
      }
    } catch (e) {}
  }, 3000);
}

// ============ 外链拦截：点击 <a target=_blank> 用系统浏览器打开 ============
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (a && a.href && a.href.indexOf(location.host) === -1) {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send('open-external', a.href);
  }
}, true);

// ============ Extension panel 自动聚焦 + 鼠标点击选择 ============
// 修复 pi-web 0.7.17 的扩展面板：
// 1. 自动聚焦不可见输入框（opacity:0 + pointer-events:none），让键盘能操作
// 2. 加鼠标支持：点击选项行 → 模拟方向键导航到该选项 → 模拟 Enter 选中
let extFocusObserverStarted = false;
function startExtensionFocusObserver() {
  if (extFocusObserverStarted) return;
  extFocusObserverStarted = true;

  const findPanelElements = () => {
    // 找 Extension panel 容器（含 "Extension panel" 文字的 div）
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const text = div.textContent || '';
      if (!text.includes('Extension panel')) continue;
      const pre = div.querySelector('pre');
      const input = div.querySelector('input');
      if (pre && input) return { pre, input };
    }
    return null;
  };

  const tryFocusInvisibleInput = () => {
    const els = findPanelElements();
    if (els) els.input.focus();
  };

  const setupMouseSupport = () => {
    const els = findPanelElements();
    if (!els) return;
    const { pre, input } = els;
    if (pre.dataset.mouseSupport) return; // 已绑定
    pre.dataset.mouseSupport = 'true';
    pre.style.cursor = 'pointer';
    pre.style.userSelect = 'none';

    // hover 高亮：鼠标移动时显示当前位置
    pre.addEventListener('mousemove', (e) => {
      const rect = pre.getBoundingClientRect();
      const styles = getComputedStyle(pre);
      const lineHeight = parseFloat(styles.lineHeight) || (parseFloat(styles.fontSize) * 1.45);
      const paddingTop = parseFloat(styles.paddingTop) || 0;
      const hoverY = e.clientY - rect.top - paddingTop + pre.scrollTop;
      const hoverLineIdx = Math.floor(hoverY / lineHeight);
      pre.title = `点击选项（第 ${hoverLineIdx + 1} 行）`;
    });

    pre.addEventListener('mouseleave', () => { pre.title = ''; });

    pre.addEventListener('click', async (e) => {
      // 计算点击了第几行
      const rect = pre.getBoundingClientRect();
      const styles = getComputedStyle(pre);
      const lineHeight = parseFloat(styles.lineHeight) || (parseFloat(styles.fontSize) * 1.45);
      const paddingTop = parseFloat(styles.paddingTop) || 0;
      const clickY = e.clientY - rect.top - paddingTop + pre.scrollTop;
      const clickedLineIdx = Math.floor(clickY / lineHeight);

      // 获取所有行
      const lines = pre.innerText.split('\n');

      // 识别选项行（非空、非提示文字）
      const hintKeywords = ['type filter', 'backspace erase', 'navigate', 'enter select', 'esc clear', 'cancel', 'ctrl+', 'add context', 'press enter to select', 'to select this option'];
      const optionLines = [];
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (hintKeywords.some(kw => trimmed.toLowerCase().includes(kw))) return;
        if (/^(question|filter)\s*$/i.test(trimmed)) return;
        optionLines.push({ lineIdx: i, text: trimmed });
      });
      if (optionLines.length === 0) return;

      // 找点击的选项
      const clickedOption = optionLines.findIndex(o => o.lineIdx === clickedLineIdx);
      if (clickedOption < 0) return;

      // 找当前选中的选项（有 → ❯ ▸ ► > 标记的行）
      let currentOption = 0;
      optionLines.forEach((o, i) => {
        if (/^[❯▸►>]\s/.test(o.text) || /^[❯▸►>]/.test(o.text)) {
          currentOption = i;
        }
      });

      // 导航：通过 Electron 主进程发送真实键盘事件（React 无法忽略）
      const diff = clickedOption - currentOption;
      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          await ipcRenderer.invoke('ext-panel-key', 'Down');
          await new Promise(r => setTimeout(r, 80));
        }
      } else if (diff < 0) {
        for (let i = 0; i < Math.abs(diff); i++) {
          await ipcRenderer.invoke('ext-panel-key', 'Up');
          await new Promise(r => setTimeout(r, 80));
        }
      }
      // 选中：发送真实 Enter 键
      await new Promise(r => setTimeout(r, 80));
      await ipcRenderer.invoke('ext-panel-key', 'Enter');
    });
  };

  const observer = new MutationObserver(() => {
    if (document.body && document.body.textContent && document.body.textContent.includes('Extension panel')) {
      tryFocusInvisibleInput();
      setupMouseSupport();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// ============ 启动 ============
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    startObserver();
    startExtensionFocusObserver();
  });
} else {
  startObserver();
  startExtensionFocusObserver();
}

// 暴露给页面（如需要）
window.__piDesktop = {
  version: '1.0.0',
};

// ============ 临时按钮：一键弹出 Extension panel ============
console.log('[pi-preload] trigger button init');
(function addTriggerButton() {
  function createBtn() {
    if (document.getElementById('__pi_trigger_btn')) return;
    if (!document.body) { setTimeout(createBtn, 200); return; }

    const btn = document.createElement('button');
    btn.id = '__pi_trigger_btn';
    btn.textContent = '📋 扩展面板';
    Object.assign(btn.style, {
      position:'fixed', bottom:'12px', right:'12px', zIndex:'2147483647',
      padding:'10px 18px', borderRadius:'8px', border:'2px solid #cba6f7',
      background:'#1e1e2e', color:'#cba6f7', fontSize:'14px', fontWeight:'700',
      cursor:'pointer', fontFamily:'system-ui', boxShadow:'0 0 20px rgba(203,166,247,.5)',
      letterSpacing:'1px',
    });
    btn.onmouseenter = () => { btn.style.background = '#313244'; };
    btn.onmouseleave = () => { btn.style.background = '#1e1e2e'; };

    btn.onclick = async () => {
      const input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      if (input) input.focus();
      await new Promise(r => setTimeout(r, 100));
      try {
        await ipcRenderer.invoke('ext-panel-key', '/');
        btn.textContent = '✅ 已发送 /';
        setTimeout(() => { btn.textContent = '📋 扩展面板'; }, 2000);
      } catch(e) {
        btn.textContent = '❌ ' + e.message.slice(0, 20);
      }
    };

    document.body.appendChild(btn);
    console.log('[pi-preload] trigger button appended');
  }

  createBtn();
  // 兜底：pi-web SPA 路由切换可能清掉 body 内容
  new MutationObserver(() => { createBtn(); }).observe(document.documentElement, { childList: true, subtree: true });
})();


