import React from 'react';

const OpenVpnWarning = ({ isVisible, platform, installationGuide, onCheckAgain }) => {
  if (!isVisible) return null;

  const platformName = platform || 'your system';
  const guideUrl = installationGuide || 'https://openvpn.net/community-downloads/';

  return (
    <div className="bg-yellow-900 border-l-4 border-yellow-500 p-4 mb-4">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-yellow-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-yellow-200">
            OpenVPN is not installed
          </h3>
          <div className="mt-2 text-sm text-yellow-300">
            <p>
              OpenVPN is required to use this application. Please install OpenVPN on {platformName} to continue.
            </p>
          </div>
          <div className="mt-4 flex gap-3">
            <a
              href={guideUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-yellow-800 bg-yellow-200 hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors"
            >
              Download OpenVPN
            </a>
            {onCheckAgain && (
              <button
                onClick={onCheckAgain}
                className="inline-flex items-center px-3 py-2 border border-yellow-400 text-sm leading-4 font-medium rounded-md text-yellow-200 bg-transparent hover:bg-yellow-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors"
              >
                Check Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenVpnWarning;

