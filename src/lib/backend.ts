import { getBackendSettings } from './backend-settings';

export function isSelfHosted() {
  return getBackendSettings()?.backend === 'self-hosted';
}

export function isBackendConfigured() {
  return getBackendSettings() !== null;
}

export function getBackendUrl() {
  const settings = getBackendSettings();
  if (!settings) throw new Error('Choose your server when creating a circle, or scan an invitation QR.');
  return settings.url;
}
