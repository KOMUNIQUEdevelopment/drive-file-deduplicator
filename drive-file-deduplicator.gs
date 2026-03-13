/**
 * =========================================================
 * Google Drive File Deduplicator
 * Full Scan + Changes API Version
 * =========================================================
 *
 * This script supports two modes:
 *
 * 1. initialFullDriveDeduplication()
 *    Runs a full scan across the Shared Drive and renames
 *    already existing duplicate filenames within each folder.
 *
 * 2. processDriveChanges()
 *    Uses the Google Drive Changes API to process only new
 *    or modified files after the initial cleanup.
 *
 * Duplicate files are renamed using incremental suffixes:
 *   filename.ext
 *   filename_0002.ext
 *   filename_0003.ext
 *
 * A log of all rename operations is written to a Google Sheet.
 *
 * Requirements:
 * - Google Apps Script
 * - Advanced Drive Service enabled
 * - Access to the target Shared Drive
 *
 * =========================================================
 */


/**
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

const SHARED_DRIVE_ID = 'REPLACE_WITH_SHARED_DRIVE_ID';

const CHANGE_TRIGGER_FUNCTION_NAME = 'processDriveChanges';

const PAGE_SIZE = 200;
const MAX_RENAMES_PER_RUN = 300;
const MAX_GROUPS_PER_FULL_SCAN_BATCH = 10000;

const START_PAGE_TOKEN_KEY = 'START_PAGE_TOKEN';

const LOG_SPREADSHEET_ID_KEY = 'LOG_SPREADSHEET_ID';
const LOG_SPREADSHEET_ID = '';
const LOG_SHEET_NAME = 'Rename Log';


/**
 * =========================================================
 * INITIAL FULL SCAN
 * =========================================================
 */

function initialFullDriveDeduplication() {

  const allFiles = listAllFilesInSharedDrive_();

  const groups = new Map();

  for (const file of allFiles) {

    if (!file.parents || file.parents.length === 0) continue;
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;

    const parentId = file.parents[0];
    const parts = splitNameAndExtension_(file.name);
    const normalizedBaseName = stripTrailingCounter_(parts.baseName);

    const key = buildFamilyKey_(parentId, normalizedBaseName, parts.extension);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);

  }

  let totalRenames = 0;
  const logRows = [];

  for (const [key, files] of groups.entries()) {

    if (files.length < 2) continue;

    const [parentId, normalizedBaseName, extension] = parseFamilyKey_(key);

    const result = renameSortedFamily_(
      files,
      parentId,
      normalizedBaseName,
      extension,
      Number.MAX_SAFE_INTEGER
    );

    totalRenames += result.renameCount;

    if (result.logRows.length > 0) logRows.push(...result.logRows);

  }

  if (logRows.length > 0) appendLogs_(logRows);

}


/**
 * =========================================================
 * CHANGES API PROCESSOR
 * =========================================================
 */

function processDriveChanges() {

  const props = PropertiesService.getScriptProperties();
  let startPageToken = props.getProperty(START_PAGE_TOKEN_KEY);

  if (!startPageToken) {

    const tokenResponse = Drive.Changes.getStartPageToken({
      driveId: SHARED_DRIVE_ID,
      supportsAllDrives: true
    });

    props.setProperty(START_PAGE_TOKEN_KEY, tokenResponse.startPageToken);
    return;

  }

  let pageToken = startPageToken;
  let renameCount = 0;
  const logRows = [];

  do {

    const response = Drive.Changes.list({
      pageToken: pageToken,
      driveId: SHARED_DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: PAGE_SIZE,
      fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,createdTime,modifiedTime,webViewLink))'
    });

    const changes = response.changes || [];

    for (const change of changes) {

      if (renameCount >= MAX_RENAMES_PER_RUN) break;
      if (change.removed) continue;
      if (!change.file) continue;

      const file = change.file;

      if (!file.parents || file.parents.length === 0) continue;
      if (file.mimeType === 'application/vnd.google-apps.folder') continue;

      const parentId = file.parents[0];
      const parts = splitNameAndExtension_(file.name);
      const normalizedBaseName = stripTrailingCounter_(parts.baseName);

      const familyFiles = listFamilyFilesInFolder_(
        parentId,
        normalizedBaseName,
        parts.extension
      );

      if (familyFiles.length < 2) continue;

      const result = renameSortedFamily_(
        familyFiles,
        parentId,
        normalizedBaseName,
        parts.extension,
        MAX_RENAMES_PER_RUN - renameCount
      );

      renameCount += result.renameCount;

      if (result.logRows.length > 0) logRows.push(...result.logRows);

    }

    pageToken = response.nextPageToken;

    if (response.newStartPageToken) {
      props.setProperty(START_PAGE_TOKEN_KEY, response.newStartPageToken);
    }

  } while (pageToken && renameCount < MAX_RENAMES_PER_RUN);

  if (logRows.length > 0) appendLogs_(logRows);

}


/**
 * =========================================================
 * DRIVE FETCH HELPERS
 * =========================================================
 */

function listAllFilesInSharedDrive_() {

  const files = [];
  let pageToken = null;

  do {

    const response = Drive.Files.list({
      corpora: 'drive',
      driveId: SHARED_DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: `trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      pageSize: PAGE_SIZE,
      pageToken: pageToken,
      fields: 'nextPageToken, files(id,name,mimeType,parents,createdTime,modifiedTime,webViewLink)'
    });

    if (response.files) files.push(...response.files);
    pageToken = response.nextPageToken;

  } while (pageToken);

  return files;

}


function listFamilyFilesInFolder_(parentId, normalizedBaseName, extension) {

  const files = [];
  let pageToken = null;

  const query = [
    `trashed = false`,
    `'${parentId}' in parents`,
    `mimeType != 'application/vnd.google-apps.folder'`
  ].join(' and ');

  do {

    const response = Drive.Files.list({
      corpora: 'drive',
      driveId: SHARED_DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: query,
      pageSize: PAGE_SIZE,
      pageToken: pageToken,
      fields: 'nextPageToken, files(id,name,parents,createdTime,modifiedTime,webViewLink)'
    });

    const batch = response.files || [];

    for (const file of batch) {

      const parts = splitNameAndExtension_(file.name);

      if (parts.extension !== extension) continue;
      if (stripTrailingCounter_(parts.baseName) !== normalizedBaseName) continue;

      files.push(file);

    }

    pageToken = response.nextPageToken;

  } while (pageToken);

  return files;

}


/**
 * =========================================================
 * DUPLICATE RENAME LOGIC
 * =========================================================
 */

function renameSortedFamily_(familyFiles, parentId, normalizedBaseName, extension, remainingRenameBudget) {

  if (familyFiles.length < 2) return { renameCount: 0, logRows: [] };

  familyFiles.sort((a, b) => {
    if (a.modifiedTime !== b.modifiedTime) return a.modifiedTime < b.modifiedTime ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  let renameCount = 0;
  const logRows = [];

  for (let i = 0; i < familyFiles.length; i++) {

    if (renameCount >= remainingRenameBudget) break;

    const file = familyFiles[i];

    const targetName = buildTargetFilename_(normalizedBaseName, extension, i + 1);

    if (file.name === targetName) continue;

    Drive.Files.update(
      { name: targetName },
      file.id,
      null,
      { supportsAllDrives: true }
    );

    logRows.push([
      new Date(),
      SHARED_DRIVE_ID,
      parentId,
      file.id,
      file.name,
      targetName,
      normalizedBaseName,
      extension,
      file.createdTime || '',
      file.webViewLink || ''
    ]);

    renameCount++;

  }

  return { renameCount, logRows };

}


function buildTargetFilename_(normalizedBaseName, extension, position) {

  if (position === 1) {
    return extension ? `${normalizedBaseName}.${extension}` : normalizedBaseName;
  }

  const suffix = `_${String(position).padStart(4, '0')}`;

  return extension
    ? `${normalizedBaseName}${suffix}.${extension}`
    : `${normalizedBaseName}${suffix}`;

}


/**
 * =========================================================
 * LOGGING
 * =========================================================
 */

function appendLogs_(rows) {

  const spreadsheet = getOrCreateLogSpreadsheet_();
  const sheet = getOrCreateLogSheet_(spreadsheet);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

}


function getOrCreateLogSpreadsheet_() {

  const props = PropertiesService.getScriptProperties();

  let spreadsheetId =
    LOG_SPREADSHEET_ID || props.getProperty(LOG_SPREADSHEET_ID_KEY);

  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  const spreadsheet = SpreadsheetApp.create('Drive Rename Log');

  props.setProperty(LOG_SPREADSHEET_ID_KEY, spreadsheet.getId());

  return spreadsheet;

}


function getOrCreateLogSheet_(spreadsheet) {

  let sheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);

  if (!sheet) {

    sheet = spreadsheet.insertSheet(LOG_SHEET_NAME);

    sheet.appendRow([
      'Timestamp',
      'SharedDriveId',
      'ParentFolderId',
      'FileId',
      'OldName',
      'NewName',
      'NormalizedBaseName',
      'Extension',
      'CreatedTime',
      'FileLink'
    ]);

    sheet.setFrozenRows(1);

  }

  return sheet;

}


/**
 * =========================================================
 * TRIGGER HELPERS
 * =========================================================
 */

function createTriggerEvery10Minutes() {

  deleteExistingTriggers_();

  ScriptApp.newTrigger(CHANGE_TRIGGER_FUNCTION_NAME)
    .timeBased()
    .everyMinutes(10)
    .create();

}


function deleteExistingTriggers_() {

  const triggers = ScriptApp.getProjectTriggers();

  for (const trigger of triggers) {

    if (trigger.getHandlerFunction() === CHANGE_TRIGGER_FUNCTION_NAME) {
      ScriptApp.deleteTrigger(trigger);
    }

  }

}


/**
 * =========================================================
 * TOKEN HELPERS
 * =========================================================
 */

function resetStartPageToken() {
  PropertiesService.getScriptProperties().deleteProperty(START_PAGE_TOKEN_KEY);
}


function initializeStartPageToken() {

  const tokenResponse = Drive.Changes.getStartPageToken({
    driveId: SHARED_DRIVE_ID,
    supportsAllDrives: true
  });

  PropertiesService.getScriptProperties().setProperty(
    START_PAGE_TOKEN_KEY,
    tokenResponse.startPageToken
  );

}


/**
 * =========================================================
 * UTILITY HELPERS
 * =========================================================
 */

function splitNameAndExtension_(filename) {

  const lastDot = filename.lastIndexOf('.');

  if (lastDot <= 0) {
    return { baseName: filename, extension: '' };
  }

  return {
    baseName: filename.substring(0, lastDot),
    extension: filename.substring(lastDot + 1)
  };

}


function stripTrailingCounter_(baseName) {
  return baseName.replace(/_\d{4}$/, '');
}


function buildFamilyKey_(parentId, normalizedBaseName, extension) {
  return `${parentId}___${normalizedBaseName}___${extension}`;
}


function parseFamilyKey_(key) {
  const parts = key.split('___');
  return [parts[0], parts[1], parts[2]];
}
