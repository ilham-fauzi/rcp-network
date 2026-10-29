import React, { useState, useEffect } from 'react';
import { updateView } from '../updateView';

// The banner's link opens the update section through this window event
export const OPEN_UPDATE_SECTION = 'rcp-open-update-section';

// Follows the main process's update state
export const useUpdateState = () => {
  const [update, setUpdate] = useState({ state: 'idle' });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api || !api.getUpdateState) return undefined;
    let active = true;
    api.getUpdateState().then((s) => { if (active && s) setUpdate(s); }).catch(() => {});
    const subscription = api.on('update-state', (s) => setUpdate(s));
    return () => {
      active = false;
      api.removeListener('update-state', subscription);
    };
  }, []);

  return update;
};

// Thin bar at the top when a newer version is found
export const UpdateBanner = () => {
  const view = updateView(useUpdateState());
  const [dismissed, setDismissed] = useState(null);
  if (!view.banner || dismissed === view.banner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-center gap-3 px-4 py-1 text-xs bg-blue-600 text-white">
      <span>{view.banner}</span>
      <button
        onClick={() => window.dispatchEvent(new Event(OPEN_UPDATE_SECTION))}
        className="underline font-semibold hover:text-blue-100"
      >
        View update
      </button>
      <button onClick={() => setDismissed(view.banner)} className="ml-2 text-blue-100 hover:text-white" aria-label="Dismiss">
        ×
      </button>
    </div>
  );
};

// Check for Updates button next to the version label, plus the update section
const UpdateSection = ({ appVersion }) => {
  const update = useUpdateState();
  const view = updateView(update);
  const [open, setOpen] = useState(false);
  const [autoCheck, setAutoCheck] = useState(true);

  useEffect(() => {
    const api = window.electronAPI;
    if (api && api.getAutoUpdateCheck) api.getAutoUpdateCheck().then(setAutoCheck).catch(() => {});
    const show = () => setOpen(true);
    window.addEventListener(OPEN_UPDATE_SECTION, show);
    return () => window.removeEventListener(OPEN_UPDATE_SECTION, show);
  }, []);

  // A manual check from the tray opens the section too
  useEffect(() => {
    if (update.state === 'checking') setOpen(true);
  }, [update.state]);

  const api = window.electronAPI;
  const handleCheck = () => {
    setOpen(true);
    if (api && api.checkForUpdates) api.checkForUpdates();
  };
  const handleAutoCheck = (event) => {
    const value = event.target.checked;
    setAutoCheck(value);
    if (api && api.setAutoUpdateCheck) api.setAutoUpdateCheck(value);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <p>Version {appVersion}</p>
        <button
          onClick={handleCheck}
          disabled={view.checkDisabled}
          className="px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Check for Updates
        </button>
      </div>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 z-50 p-4 rounded-lg shadow-lg bg-gray-800 text-gray-200 border border-gray-700 text-xs">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-sm">Updates</h4>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white" aria-label="Close">×</button>
          </div>

          {view.text && <p className="mt-2">{view.text}</p>}
          {view.percent !== null && (
            <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
              <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${view.percent}%` }}></div>
            </div>
          )}
          {view.error && <p className="mt-2 text-red-300">{view.error}</p>}
          {view.notes && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-gray-400">{view.notes}</pre>
          )}
          {view.note && <p className="mt-2 text-yellow-300">{view.note}</p>}

          <div className="mt-3 flex gap-2">
            {view.showInstall && (
              <button onClick={() => api && api.installUpdate()} className="px-3 py-1 rounded bg-primary text-white hover:opacity-90">
                Update and Restart
              </button>
            )}
            {view.showOpenPage && (
              <button onClick={() => api && api.openUpdatePage()} className="px-3 py-1 rounded border border-gray-600 hover:bg-gray-700">
                Open Download Page
              </button>
            )}
          </div>

          <label className="mt-3 flex items-center gap-2 text-gray-400">
            <input type="checkbox" checked={autoCheck} onChange={handleAutoCheck} />
            Check for updates automatically
          </label>
        </div>
      )}
    </div>
  );
};

export default UpdateSection;
