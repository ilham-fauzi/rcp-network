// What the update UI shows for an "update-state" from the main process.
// Plain CommonJS with no React, so node --test can check it.

const NO_DOWNLOAD_NOTE = 'This release has no signed download for your system.';

const updateView = (update) => {
  const s = update || { state: 'idle' };
  const view = {
    text: null,
    notes: null,
    percent: null,
    error: null,
    banner: null,
    checkDisabled: false,
    showInstall: false,
    showOpenPage: false,
    note: null,
  };

  switch (s.state) {
    case 'checking':
      view.text = 'Checking for updates…';
      view.checkDisabled = true;
      break;
    case 'up-to-date':
      view.text = 'RCP Network is up to date.';
      break;
    case 'available':
      view.text = `Version ${s.version} is available.`;
      view.notes = s.notes || null;
      view.banner = `RCP Network ${s.version} is available`;
      if (!s.installable) {
        view.showOpenPage = true;
        view.note = NO_DOWNLOAD_NOTE;
      } else if (!s.canSelfInstall) {
        view.showOpenPage = true;
        view.note = s.cannotInstallReason || null;
      } else {
        view.showInstall = true;
      }
      break;
    case 'downloading':
      view.percent = Math.max(0, Math.min(100, Math.floor(s.percent || 0)));
      view.text = `Downloading version ${s.version}… ${view.percent}%`;
      view.checkDisabled = true;
      break;
    case 'installing':
      view.text = 'Installing… RCP Network will restart.';
      view.checkDisabled = true;
      break;
    case 'failed':
      view.text = 'The update failed.';
      view.error = s.error || 'Unknown error';
      if (s.pageUrl) view.showOpenPage = true;
      break;
    default:
      break;
  }
  return view;
};

module.exports = { updateView, NO_DOWNLOAD_NOTE };
