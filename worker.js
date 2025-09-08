// Album ranges
const albumRanges = {
  1: { start: 1, end: 13, count: 13 },
  2: { start: 14, end: 43, count: 30 },
  3: { start: 44, end: 68, count: 25 },
  4: { start: 69, end: 91, count: 23 },
  5: { start: 92, end: 125, count: 34 },
  6: { start: 126, end: 147, count: 22 },
  7: { start: 148, end: 183, count: 36 },
  8: { start: 184, end: 206, count: 23 },
  9: { start: 207, end: 215, count: 9 },
  10: { start: 216, end: 238, count: 23 },
  11: { start: 239, end: 261, count: 23 },
  12: { start: 262, end: 283, count: 22 },
  13: { start: 284, end: 297, count: 14 },
  14: { start: 298, end: 330, count: 33 },
  15: { start: 331, end: 351, count: 21 },
  16: { start: 352, end: 370, count: 19 },
  17: { start: 371, end: 471, count: 101 }  
};

// Base URL for raw GitHub files
const baseUrl = 'https://raw.githubusercontent.com/DbRDYZmMRu/freshPlayerBucket/main';

// Function to get album for a given ID
function getAlbumForId(id) {
  for (const [album, range] of Object.entries(albumRanges)) {
    if (id >= range.start && id <= range.end) {
      return album;
    }
  }
  return null;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Adjust to specific origins in production
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges'
};

// Handle OPTIONS requests for CORS preflight
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

// Worker handler
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  console.log('Requested URL:', url.pathname, 'Path Parts:', pathParts); // Debug log
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }
  
  // Handle resource fetching
  if (pathParts[1] === 'resource' && pathParts[2]) {
    const id = parseInt(pathParts[2]);
    return handleResourceRequest(id, url);
  }
  
  // Handle audio and cover proxy requests
  if (['audio', 'cover'].includes(pathParts[1]) && pathParts[2] && pathParts[3]) {
    const type = pathParts[1];
    const album = pathParts[2];
    const file = pathParts[3];
    return handleProxyRequest(type, album, file, request);
  }
  
  return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

async function handleResourceRequest(id, url) {
  console.log('Handling resource request for ID:', id); // Debug log
  
  // Validate ID
  if (isNaN(id) || id < 1 || id > 452) {
    return new Response(JSON.stringify({ error: 'Invalid ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
  
  // Get the album for the ID
  const album = getAlbumForId(id);
  if (!album) {
    return new Response(JSON.stringify({ error: 'ID not found in any album' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
  
  // Construct proxy URLs
  const baseWorkerUrl = `${url.origin}`;
  const audioProxyUrl = `${baseWorkerUrl}/audio/${album}/${id}.mp3`;
  const coverProxyUrl = `${baseWorkerUrl}/cover/${album}/${id}.jpg`;
  const jsonUrl = `${baseUrl}/json/${album}/${id}.json`;
  
  try {
    // Fetch JSON data
    const jsonResponse = await fetch(jsonUrl);
    console.log('Fetching JSON from:', jsonUrl, 'Status:', jsonResponse.status); // Debug log
    if (!jsonResponse.ok) {
      throw new Error('JSON file not found');
    }
    const jsonData = await jsonResponse.json();
    
    // Return response with proxy URLs and JSON data
    return new Response(JSON.stringify({
      id,
      album,
      audio: audioProxyUrl,
      cover: coverProxyUrl,
      json: jsonData
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.log('Error in handleResourceRequest:', error.message); // Debug log
    return new Response(JSON.stringify({ error: 'Failed to fetch resources', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleProxyRequest(type, album, file, request) {
  console.log('Handling proxy request:', { type, album, file }); // Debug log
  
  // Validate type
  if (!['audio', 'cover'].includes(type)) {
    return new Response(JSON.stringify({ error: 'Invalid resource type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
  
  // Construct GitHub URL
  const githubUrl = `${baseUrl}/${type}/${album}/${file}`;
  const contentType = type === 'audio' ? 'audio/mpeg' : 'image/jpeg';
  
  try {
    // Get the Range header from the request
    const rangeHeader = request.headers.get('Range');
    const headers = {};
    if (rangeHeader && type === 'audio') {
      headers['Range'] = rangeHeader;
    }
    
    // Fetch the resource from GitHub
    const response = await fetch(githubUrl, { headers });
    console.log('Fetching file from:', githubUrl, 'Status:', response.status); // Debug log
    if (!response.ok) {
      throw new Error(`${type} file not found`);
    }
    
    // Get the file content and size
    const fileContent = await response.arrayBuffer();
    const fileSize = fileContent.byteLength;
    
    // Handle byte-range requests for audio
    if (type === 'audio' && rangeHeader) {
      const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!rangeMatch) {
        return new Response(JSON.stringify({ error: 'Invalid Range header' }), {
          status: 416,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      const start = parseInt(rangeMatch[1]);
      let end = rangeMatch[2] ? parseInt(rangeMatch[2]) : fileSize - 1;
      if (end >= fileSize) {
        end = fileSize - 1;
      }
      
      // Ensure valid range
      if (start >= fileSize || end < start) {
        return new Response(JSON.stringify({ error: 'Requested Range Not Satisfiable' }), {
          status: 416,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Slice the file content to the requested range
      const slicedContent = fileContent.slice(start, end + 1);
      const contentLength = slicedContent.byteLength;
      
      // Return partial content response
      return new Response(slicedContent, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': contentLength,
          'Accept-Ranges': 'bytes',
          ...corsHeaders
        }
      });
    }
    
    // Return full file if no range header or for cover images
    return new Response(fileContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.log('Error in handleProxyRequest:', error.message); // Debug log
    return new Response(JSON.stringify({ error: `Failed to fetch ${type}`, details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
              }
