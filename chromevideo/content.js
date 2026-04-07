// 这里是注入到网页中运行的代码，可以操作网页DOM
console.log('[Content Script] Chrome Video 插件已注入到页面');
console.log('[Content Script] 页面 URL:', window.location.href);

// 监听来自 popup 或者 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content Script] 收到消息:', JSON.stringify(message));
  console.log('[Content Script] 发送者:', sender);
  
  if (message.action === 'navigate' && message.url) {
    console.log('[Content Script] 执行跳转动作, 目标:', message.url);
    window.location.href = message.url;
    sendResponse({ status: 'ok', message: '已跳转到 ' + message.url });
  } else if (message.action === 'ping') {
    console.log('[Content Script] 执行 ping 动作');
    const response = { status: 'ok', message: 'Content script 收到消息了！' };
    sendResponse(response);
  }
  
  // 返回 true 以表示将会异步发送响应（如果需要）
  return true;
});
