import React from 'react';

const LoadingSkeleton = ({ rows = 4 }) => {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={`skeleton-${index}`} className="h-12 rounded bg-gray-200" />
      ))}
    </div>
  );
};

export default LoadingSkeleton;
