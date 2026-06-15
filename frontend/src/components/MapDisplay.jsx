// MapDisplay.jsx
// Renders an OpenStreetMap embed for a single lat/lng coordinate.
// Falls back to an address-based search if lat/lng not available.

import { useState } from 'react';

export default function MapDisplay({ latitude, longitude, address, height = 180 }) {
  const [mapError, setMapError] = useState(false);

  const hasCoords = latitude != null && longitude != null;

  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${Number(longitude) - 0.005}%2C${Number(latitude) - 0.003}%2C${Number(longitude) + 0.005}%2C${Number(latitude) + 0.003}&layer=mapnik&marker=${latitude}%2C${longitude}`
    : null;

  const searchSrc = address
    ? `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=map&zoom=15`
    : null;

  if (!hasCoords && !address) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800/40 text-slate-500 text-xs select-none"
        style={{ height }}
      >
        No location set
      </div>
    );
  }

  if (hasCoords && !mapError) {
    return (
      <iframe
        title="Restaurant Location"
        width="100%"
        height={height}
        src={mapSrc}
        style={{ border: 0, borderRadius: '12px' }}
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        onError={() => setMapError(true)}
      />
    );
  }

  // Fallback: address-based embed
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800/40 text-slate-400 text-xs"
      style={{ height }}
    >
      <span className="text-center px-4">{address || 'Location unavailable'}</span>
    </div>
  );
}
