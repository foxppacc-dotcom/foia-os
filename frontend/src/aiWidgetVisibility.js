// Shared localStorage keys + window event names for the two independent
// visibility toggles around the AI assistant:
//
// 1. الربط الذكي's own toggle controls whether the Dashboard's "المساعد
//    الذكي" button is shown at all (WIDGET_BUTTON_HIDDEN_KEY).
// 2. The Dashboard button itself (when shown) controls whether the
//    floating bubble is shown (WIDGET_HIDDEN_KEY) -- unchanged from before.
//
// Kept in one small shared file (not re-exported from AIAssistantWidget.jsx)
// since Dashboard.jsx, AIAssistantSettings.jsx, and AIAssistantWidget.jsx all
// need these names and none of them should have to import a component file
// just to get a string constant.
export const WIDGET_HIDDEN_KEY = 'ai_widget_hidden';
export const WIDGET_VISIBILITY_EVENT = 'ai-widget-visibility-changed';

export const DASHBOARD_BUTTON_HIDDEN_KEY = 'ai_dashboard_button_hidden';
export const DASHBOARD_BUTTON_VISIBILITY_EVENT = 'ai-dashboard-button-visibility-changed';
