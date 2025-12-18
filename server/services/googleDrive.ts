import { google } from 'googleapis';
import { Readable } from 'stream';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-drive',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Drive not connected');
  }
  return accessToken;
}

async function getUncachableGoogleDriveClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

export async function uploadPdfToDrive(
  pdfBuffer: Buffer, 
  fileName: string, 
  folderId?: string
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = await getUncachableGoogleDriveClient();
  
  const fileMetadata: any = {
    name: fileName,
    mimeType: 'application/pdf',
  };
  
  if (folderId) {
    fileMetadata.parents = [folderId];
  }

  const media = {
    mimeType: 'application/pdf',
    body: Readable.from(pdfBuffer),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
  });

  const fileId = response.data.id || '';
  
  // Make the file publicly accessible so users can view the invoice PDF
  if (fileId) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
      console.log(`[GoogleDrive] Made file ${fileId} publicly accessible`);
    } catch (permError) {
      console.error(`[GoogleDrive] Failed to set public permissions:`, permError);
      // Continue anyway - file is uploaded, just not public
    }
  }

  return {
    fileId,
    webViewLink: response.data.webViewLink || '',
  };
}

export async function getFileFromDrive(fileId: string): Promise<Buffer> {
  const drive = await getUncachableGoogleDriveClient();
  
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  
  return Buffer.from(response.data as ArrayBuffer);
}

export async function createFolderIfNotExists(folderName: string): Promise<string> {
  const drive = await getUncachableGoogleDriveClient();
  
  const searchResponse = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    return searchResponse.data.files[0].id || '';
  }

  const createResponse = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  return createResponse.data.id || '';
}
