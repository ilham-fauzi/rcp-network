import React, { useState, useEffect } from 'react';

const VpnAuthDialog = ({ 
  isVisible, 
  server, 
  onConnect, 
  onCancel,
  savedEmail,
  savedPassword
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saveEmail, setSaveEmail] = useState(false);
  const [savePassword, setSavePassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isVisible) {
      if (savedEmail) {
        setEmail(savedEmail);
      } else {
        setEmail('');
      }
      if (savedPassword) {
        setPassword(savedPassword);
      } else {
        setPassword('');
      }
    }
  }, [isVisible, savedEmail, savedPassword]);

  if (!isVisible) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!email.trim() || !password.trim()) {
      return;
    }

    setIsLoading(true);
    
    try {
      await onConnect({
        email: email.trim(),
        password: password,
        saveEmail: saveEmail,
        savePassword: savePassword
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setEmail('');
    setPassword('');
    setSaveEmail(false);
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
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
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">VPN Authentication</h2>
            <p className="text-sm text-gray-400">{server?.name || 'Server'}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Email:
            </label>
            <div className="flex gap-2 items-start">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                className="flex-1 px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                required
                disabled={isLoading || !!savedEmail}
                autoFocus={!savedEmail}
              />
              <div className="flex items-center gap-2 pt-2.5">
                <input
                  type="checkbox"
                  id="saveEmail"
                  checked={saveEmail}
                  onChange={(e) => setSaveEmail(e.target.checked)}
                  disabled={isLoading || !!savedEmail}
                  className="w-4 h-4 text-primary bg-gray-700 border-gray-600 rounded focus:ring-primary"
                />
                <label htmlFor="saveEmail" className="text-sm text-gray-300 cursor-pointer">
                  Simpan
                </label>
              </div>
            </div>
            {savedEmail && (
              <p className="mt-1 text-xs text-gray-500">Email saved from previous connection</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Password:
            </label>
            <div className="flex gap-2 items-start">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="flex-1 px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                required
                disabled={isLoading}
                autoFocus={!!savedEmail}
              />
              <div className="flex items-center gap-2 pt-2.5">
                <input
                  type="checkbox"
                  id="savePassword"
                  checked={savePassword}
                  onChange={(e) => setSavePassword(e.target.checked)}
                  disabled={isLoading}
                  className="w-4 h-4 text-primary bg-gray-700 border-gray-600 rounded focus:ring-primary"
                />
                <label htmlFor="savePassword" className="text-sm text-gray-300 cursor-pointer">
                  Simpan
                </label>
              </div>
            </div>
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
              disabled={isLoading || !email.trim() || !password.trim()}
              className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VpnAuthDialog;

