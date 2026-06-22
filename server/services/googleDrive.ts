/**
 * Google Drive Service - Cloud Storage Integration
 * 
 * Provides authenticated access to Google Drive for invoice PDF storage.
 * Uses Replit's connector system for OAuth token management.
 * 
 * Features:
 * - Automatic token refresh via Replit connector
 * - PDF upload with public read permissions
 * - Folder creation and management
 * - File download for re-delivery
 * 
 * Authentication Flow:
 * 1. Request token from Replit connector (cached if not expired)
 * 2. Create OAuth2 client with access token
 * 3. Execute Drive API operations
 * 
 * @module server/services/googleDrive
 */

import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * OAuth credentials structure from Replit connector.
 */
interface OAuthCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
}

/**
 * Replit connector settings structure.
 */
interface ConnectorSettings {
  access_token?: string;
  expires_at?: string;
  oauth?: {
    credentials: OAuthCredentials;
  };
}

/**
 * Full connector response from Replit API.
 */
interface ConnectorResponse {
  settings: ConnectorSettings;
}

/**
 * Result of a file upload operation.
 */
interface UploadResult {
  /** Google Drive file ID */
  fileId: string;
  /** Public web view link for browser access */
  webViewLink: string;
}

/**
 * Metadata for file creation in Drive.
 */
interface FileMetadata {
  name: string;
  mimeType: string;
  parents?: string[];
}

// ============================================================================
// Module State
// ============================================================================

/**
 * Cached connector settings to avoid repeated API calls.
 * Invalidated when token expires.
 */
let cachedConnection: ConnectorResponse | null = null;

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * Retrieves a valid access token from Replit's connector system.
 * 
 * Token Refresh Logic:
 * - If cached token exists and hasn't expired, return it
 * - Otherwise, fetch fresh token from connector API
 * - Token expiry is managed by Replit's backend
 * 
 * @throws Error if Replit identity token not found or Drive not connected
 * @returns Valid Google OAuth access token
 */
async function getAccessToken(): Promise<string> {
  // Check cached token validity
  if (cachedConnection?.settings.expires_at) {
    const expiresAt = new Date(cachedConnection.settings.expires_at).getTime();
    if (expiresAt > Date.now()) {
      const token = cachedConnection.settings.access_token;
      if (token) return token;
    }
  }
  
  // Fetch fresh token from Replit connector
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error('REPLIT_CONNECTORS_HOSTNAME not configured');
  }

  // Build authentication header for Replit API
  // Supports both repl (development) and depl (deployment) contexts
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('Replit authentication token not found (REPL_IDENTITY or WEB_REPL_RENEWAL required)');
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=google-drive`,
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Connector API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cachedConnection = data.items?.[0] as ConnectorResponse | undefined ?? null;

  if (!cachedConnection) {
    throw new Error('Google Drive connector not configured');
  }

  // Extract access token from either direct or OAuth nested structure
  const accessToken = cachedConnection.settings.access_token 
    ?? cachedConnection.settings.oauth?.credentials.access_token;

  if (!accessToken) {
    throw new Error('Google Drive not connected - no access token available');
  }

  return accessToken;
}

/**
 * Creates an authenticated Google Drive API client.
 * 
 * Note: Client is intentionally not cached to ensure fresh tokens.
 * Token caching is handled at the access token level.
 * 
 * @returns Configured Drive API client
 */
async function getDriveClient(): Promise<drive_v3.Drive> {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Uploads a PDF buffer to Google Drive.
 * 
 * Process:
 * 1. Create file with provided metadata
 * 2. Upload PDF content
 * 3. Set public read permissions for customer access
 * 
 * @param pdfBuffer - PDF file content as Buffer
 * @param fileName - Target filename (e.g., "INV-20231220-ABCD.pdf")
 * @param folderId - Optional parent folder ID
 * @returns Upload result with fileId and webViewLink
 */
export async function uploadPdfToDrive(
  pdfBuffer: Buffer, 
  fileName: string, 
  folderId?: string
): Promise<UploadResult> {
  const drive = await getDriveClient();
  
  // Build file metadata
  const fileMetadata: FileMetadata = {
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

  // Upload file to Drive
  console.log(`[GoogleDrive] Uploading ${fileName} to Drive...`);
  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
  });

  const fileId = response.data.id || '';
  
  // Set public read permissions for customer invoice access
  if (fileId) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
      console.log(`[GoogleDrive] Set public read permission for file ${fileId}`);
    } catch (permError) {
      // Log but don't fail - file is uploaded, just not public
      console.error(`[GoogleDrive] Failed to set public permissions:`, permError);
    }
  }

  const result: UploadResult = {
    fileId,
    webViewLink: response.data.webViewLink || '',
  };

  console.log(`[GoogleDrive] Upload complete: ${result.webViewLink}`);
  return result;
}

/**
 * Downloads a file from Google Drive.
 * 
 * @param fileId - Google Drive file ID
 * @returns File content as Buffer
 */
export async function getFileFromDrive(fileId: string): Promise<Buffer> {
  const drive = await getDriveClient();
  
  console.log(`[GoogleDrive] Downloading file ${fileId}...`);
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  
  return Buffer.from(response.data as ArrayBuffer);
}

/**
 * Creates a folder in Google Drive if it doesn't already exist.
 * 
 * Used to organize invoice PDFs in a dedicated folder.
 * Searches for existing folder by name before creating.
 * 
 * @param folderName - Name for the folder (e.g., "Midnight EPOS Invoices")
 * @returns Folder ID (existing or newly created)
 */
export async function createFolderIfNotExists(folderName: string): Promise<string> {
  const drive = await getDriveClient();
  
  // Search for existing folder
  const searchResponse = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    const existingId = searchResponse.data.files[0].id || '';
    console.log(`[GoogleDrive] Found existing folder: ${folderName} (${existingId})`);
    return existingId;
  }

  // Create new folder
  const createResponse = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  const newId = createResponse.data.id || '';
  console.log(`[GoogleDrive] Created new folder: ${folderName} (${newId})`);
  return newId;
}
