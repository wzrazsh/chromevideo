chrome.runtime.onInstalled.addListener(() => {
  console.log('Chrome Video 插件已安装！');
  // 可以在这里初始化插件的数据、设置初始状态等
});

// 监听扩展图标的点击事件
chrome.action.onClicked.addListener((tab) => {
  console.log('用户点击了扩展图标', tab);
});
