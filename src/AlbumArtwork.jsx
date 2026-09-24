import React, { useState } from "react";

// Spotify already includes artwork URLs with playback and search results.
export default function AlbumArtwork({ images, large = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const url = images?.find(image => typeof image?.url === "string" && image.url.startsWith("https://"))?.url;
  return (
    <div className={`album-artwork${large ? " album-artwork-large" : ""}`} aria-hidden="true">
      {url && failedUrl !== url ? (
        <img src={url} alt="" loading={large ? "eager" : "lazy"} referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      ) : <span>♫</span>}
    </div>
  );
}
