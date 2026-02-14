import React, { useState, useEffect } from 'react';

const SudoPasswordDialog = ({ onPasswordSubmit, onCancel, isVisible }) => {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [installProgress, setInstallProgress] = useState({
    show: false,
    step: 0,
    message: '',
    steps: [
      'Validating password...',
      'Checking OpenVPN installation...',
      'Installing Homebrew...',
      'Installing OpenVPN...',
      'Verifying installation...',
      'Setup complete!'
    ]
  });

  useEffect(() => {
    // Listen for installation progress updates from main process
    if (window.electronAPI && window.electronAPI.onInstallProgress) {
      const unsubscribe = window.electronAPI.onInstallProgress((progress) => {
        setInstallProgress(prev => ({
          ...prev,
          show: true,
          step: progress.step,
          message: progress.message
        }));
      });

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, []);

  if (!isVisible) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!password.trim()) {
      setError('Password cannot be empty');
      return;
    }

    setIsLoading(true);
    setError('');
    // Reset progress but don't show it yet until validation passes or we start installation
    setInstallProgress(prev => ({ ...prev, show: false, step: 0 }));

    try {
      // Check if Electron API is available
      if (!window.electronAPI) {
        setError('Electron not available');
        setIsLoading(false);
        return;
      }

      // Show initial validation step if we anticipate a long process or just to be responsive
      // But really the progress comes from main.js during installOpenVpnViaBrew
      
      const result = await window.electronAPI.validateSudoPassword(password);
      
      if (result.success) {
        // Check if OpenVPN was installed
        if (result.openvpnInstallStatus) {
          if (result.openvpnInstallStatus.installed) {
            // OpenVPN was successfully installed or already exists
            console.log('OpenVPN status:', result.openvpnInstallStatus.message || 'Ready');
          } else if (result.openvpnInstallStatus.error) {
            // Installation failed, but sudo password was valid
            console.warn('OpenVPN installation failed:', result.openvpnInstallStatus.error);
            // Still proceed with the app, user can install manually
          }
        }
        
        onPasswordSubmit(password);
        setPassword('');
      } else {
        setError(result.error || 'Invalid password');
        setInstallProgress(prev => ({ ...prev, show: false }));
      }
    } catch (error) {
      setError(error.message || 'An error occurred');
      setInstallProgress(prev => ({ ...prev, show: false }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setError('');
    setInstallProgress(prev => ({ ...prev, show: false }));
    onCancel();
  };

  const progressPercentage = installProgress.show 
    ? ((installProgress.step + 1) / installProgress.steps.length) * 100 
    : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">Welcome to RCP Network</h2>
            <p className="text-sm text-gray-400">
              We need your system password to complete the initial setup
            </p>
          </div>
        </div>

        {/* Installation Progress */}
        {installProgress.show && (
          <div className="mb-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-300">
                  {installProgress.message || installProgress.steps[installProgress.step]}
                </span>
                <span className="text-xs text-gray-500">
                  {installProgress.step + 1}/{installProgress.steps.length}
                </span>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-blue-600 h-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                >
                  <div className="h-full w-full bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-shimmer"></div>
                </div>
              </div>
            </div>

            {/* Installation Steps */}
            <div className="space-y-2">
              {installProgress.steps.slice(0, -1).map((step, index) => (
                <div key={index} className="flex items-center gap-2">
                  {index < installProgress.step ? (
                    // Completed
                    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : index === installProgress.step ? (
                    // Current
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                  ) : (
                    // Pending
                    <div className="w-4 h-4 border-2 border-gray-600 rounded-full flex-shrink-0"></div>
                  )}
                  <span className={`text-xs ${
                    index < installProgress.step ? 'text-gray-400 line-through' :
                    index === installProgress.step ? 'text-blue-400 font-medium' :
                    'text-gray-500'
                  }`}>
                    {step}
                  </span>
                </div>
              ))}
            </div>

            {installProgress.step >= 2 && installProgress.step < installProgress.steps.length - 1 && (
              <p className="mt-3 text-xs text-yellow-400 flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                This may take 2-5 minutes. Please wait...
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Enter your system password:
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="Your computer password"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              autoFocus
              disabled={isLoading}
            />
            {error && (
              <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Setting up...</span>
                </>
              ) : (
                'Continue'
              )}
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-gray-500 text-center">
          Your password is securely stored in your system keychain and will only be used for VPN operations. This is a one-time setup.
        </p>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
};

export default SudoPasswordDialog;
