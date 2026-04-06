// 这里是注入到网页中运行的代码，可以操作网页DOM
console.log('Chrome Video 插件：Content script 已经注入页面');

// 监听来自 popup 或者 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息：', message);
  if (message.action === 'ping') {
    // 处理特定的动作
    console.log('执行了 ping 动作');
    
    // 给发送方返回响应
    sendResponse({ status: 'ok', message: 'Content script 收到消息了！' });
  }
  
  // 返回 true 以表示将会异步发送响应（如果需要）
  return true;
});
