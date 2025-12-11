import React, { useState, useEffect, useRef } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

const TrafficChart = ({ isConnected, downloadSpeed, uploadSpeed, onConnectClick, startTime }) => {
  const [data, setData] = useState([]);
  const [duration, setDuration] = useState(0);
  const intervalRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    if (isConnected && startTime) {
      const timer = setInterval(() => {
        setDuration(Date.now() - startTime);
      }, 1000);
      setDuration(Date.now() - startTime); // Initial set
      return () => clearInterval(timer);
    } else {
      setDuration(0);
    }
  }, [isConnected, startTime]);

  useEffect(() => {
    if (isConnected) {
      // Initialize with start data immediately so chart renders instantly
      if (timeRef.current === 0) {
          setData([{ time: 0, download: 0, upload: 0, timeLabel: '0s' }]);
      }

      // Start collecting data
      intervalRef.current = setInterval(() => {
        timeRef.current += 1;
        setData((prevData) => {
          const newData = [
            ...prevData,
            {
              time: timeRef.current,
              download: downloadSpeed,
              upload: uploadSpeed,
              timeLabel: timeRef.current <= 6 ? `${timeRef.current}s` : `${timeRef.current}s`
            }
          ];
          // Keep only last 90 seconds of data
          return newData.slice(-90);
        });
      }, 1000);
    } else {
      // Clear data when disconnected
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setData([]);
      timeRef.current = 0;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isConnected, downloadSpeed, uploadSpeed]);

  // Format time label for X-axis
  const formatTimeLabel = (value) => {
    if (value === 0 || value <= 6) {
      return `${value}s`;
    } else if (value % 10 === 0 || value === 60 || value === 90) {
      return `${value}s`;
    }
    return '';
  };

  // Format speed for Y-axis
  const formatSpeed = (value) => {
    return `${value}`;
  };

  // Get current speeds
  const currentDownload = downloadSpeed || 0;
  const currentUpload = uploadSpeed || 0;

  const [chartHeight, setChartHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const chartRef = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = chartHeight;

    const handleMouseMove = (e) => {
      const diff = startY - e.clientY; // Inverted: drag up = increase height
      const newHeight = Math.max(200, Math.min(600, startHeight + diff));
      setChartHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="w-full bg-gray-800 rounded-lg p-4 border border-gray-700 relative">
      {/* Title and Current Speed Indicators */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white text-sm font-semibold">Time-Series Traffic Monitor Chart</h3>
        <div className="flex items-center gap-4">
          <div className="text-teal-400 text-xs font-bold">
            {currentDownload.toFixed(1)} MB/S DOWNLOAD
          </div>
          <div className="text-green-400 text-xs font-bold">
            {currentUpload.toFixed(1)} MB/S UPLOAD
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div 
        ref={chartRef}
        className="relative" 
        style={{ height: `${chartHeight}px`, width: '100%' }}
      >
        {isConnected ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 10, right: 10, left: 30, bottom: 30 }}
              >
              <defs>
                <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="time"
                tickFormatter={formatTimeLabel}
                stroke="#9ca3af"
                style={{ fontSize: '10px' }}
                label={{ value: 'TIME', position: 'insideBottom', offset: -5, fill: '#9ca3af', style: { fontSize: '10px' } }}
              />
              <YAxis
                stroke="#9ca3af"
                style={{ fontSize: '10px' }}
                label={{ value: 'SPEED (MB/s)', angle: -90, position: 'insideLeft', fill: '#9ca3af', style: { fontSize: '10px' } }}
                domain={[0, 40]}
                ticks={[0, 5, 10, 15, 20, 25, 30, 35, 40]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#f3f4f6'
                }}
                formatter={(value) => [`${value.toFixed(1)} MB/s`, '']}
              />
              {/* Download Area Chart */}
              <Area
                type="monotone"
                dataKey="download"
                stroke="#14b8a6"
                strokeWidth={2}
                fill="url(#downloadGradient)"
                name="Download"
              />
              {/* Upload Line Chart */}
              <Line
                type="monotone"
                dataKey="upload"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                name="Upload"
              />
            </AreaChart>
          </ResponsiveContainer>
          
          {/* Duration Overlay */}
          <div className="absolute top-4 right-4 pointer-events-none z-0">
             <span className="text-4xl font-bold text-gray-300/50 select-none font-mono">
                {formatDuration(duration)}
             </span>
          </div>

          {/* Disconnect Button Overlay - Center of Chart */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <button
              onClick={onConnectClick}
              className="pointer-events-auto w-20 h-20 rounded-full bg-red-600/30 hover:bg-red-600/50 backdrop-blur-sm border-2 border-red-500/50 hover:border-red-500/70 flex items-center justify-center transition-all transform hover:scale-110 active:scale-95 shadow-lg"
              title="Click to Disconnect"
            >
              <svg
                className="w-10 h-10 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center relative">
            {/* Empty Chart Background */}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[]}
                margin={{ top: 10, right: 10, left: 30, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  stroke="#9ca3af"
                  style={{ fontSize: '10px' }}
                  label={{ value: 'TIME', position: 'insideBottom', offset: -5, fill: '#9ca3af', style: { fontSize: '10px' } }}
                />
                <YAxis
                  stroke="#9ca3af"
                  style={{ fontSize: '10px' }}
                  label={{ value: 'SPEED (MB/s)', angle: -90, position: 'insideLeft', fill: '#9ca3af', style: { fontSize: '10px' } }}
                  domain={[0, 40]}
                  ticks={[0, 5, 10, 15, 20, 25, 30, 35, 40]}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Overlay with Play/Stop Button */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800/80 backdrop-blur-sm">
              <button
                onClick={onConnectClick}
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all transform hover:scale-105 active:scale-95 mb-3 ${
                  isConnected
                    ? 'bg-red-600/80 hover:bg-red-700/80'
                    : 'bg-gray-700/80 hover:bg-gray-600/80'
                }`}
              >
                {isConnected ? (
                  <svg
                    className="w-10 h-10 text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 6h12v12H6z" />
                  </svg>
                ) : (
                  <svg
                    className="w-10 h-10 text-white ml-1"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <p className="text-white text-sm font-medium">
                {isConnected ? 'Click to Disconnect' : 'Click to Connect'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-gray-600/50 transition-colors ${
          isResizing ? 'bg-gray-600/50' : ''
        }`}
        style={{ zIndex: 20 }}
      >
        <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-1 bg-gray-500 rounded"></div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-teal-400 rounded"></div>
          <span className="text-xs text-gray-300">Download</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-400 rounded"></div>
          <span className="text-xs text-gray-300">Upload</span>
        </div>
      </div>
    </div>
  );
};

export default TrafficChart;

