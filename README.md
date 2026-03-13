# Google Drive File Deduplicator (Apps Script)

Automatically detects duplicate filenames within folders of a Google Shared Drive and renames them using incremental suffixes.

The script is designed to keep Shared Drives clean when files are uploaded automatically by tools, integrations, or users that may create duplicate filenames.

Example result:

```
image.jpg
image_0002.jpg
image_0003.jpg
```

The script supports both:

- **Initial full cleanup of an existing Drive**
- **Continuous monitoring of new uploads using the Drive Changes API**

---

# Features

- Works with **Google Shared Drives**
- Uses the **Advanced Google Drive API**
- Resolves duplicate filenames **within the same folder**
- Adds incremental counters `_0002`, `_0003`, etc.
- Maintains a **rename log in Google Sheets**
- Supports **automatic execution via time-based triggers**
- Efficient incremental processing using the **Drive Changes API**

---

# How It Works

The script runs in two phases.

## 1. Initial cleanup (one-time)

The function:

```
initialFullDriveDeduplication()
```

Scans the entire Shared Drive and fixes already existing duplicate filenames.

This step is required **only once**.

---

## 2. Continuous monitoring

After the initial cleanup the script switches to incremental mode using the Google Drive **Changes API**.

```
processDriveChanges()
```

Only newly uploaded or modified files are checked.

This keeps the system efficient even on large drives.

---

# Requirements

- Google Apps Script
- Access to the target Shared Drive
- Advanced Google Drive API enabled

---

# Enable Drive API in Apps Script

Open the Apps Script project.

Then:

```
Services → + Add Service → Drive API
```

Select **Drive API** and add it to the project.

The script uses:

```
Drive.Files.*
Drive.Changes.*
```

---

# Configuration

Inside the script replace:

```
const SHARED_DRIVE_ID = 'REPLACE_WITH_SHARED_DRIVE_ID';
```

You can find the Shared Drive ID in the URL:

```
https://drive.google.com/drive/folders/SHARED_DRIVE_ID
```

---

# First-Time Setup

Run the following steps once.

## Step 1 — Clean existing duplicates

Run manually:

```
initialFullDriveDeduplication()
```

This may take some time depending on the number of files.

---

## Step 2 — Initialize the Changes API token

Run:

```
initializeStartPageToken()
```

This stores the starting checkpoint used by the Changes API.

---

## Step 3 — Enable automatic monitoring

Run:

```
createTriggerEvery10Minutes()
```

The script will now automatically check for new uploads every 10 minutes.

---

# Logging

Every rename operation is written to a Google Spreadsheet.

If no log sheet exists, the script automatically creates one:

```
Drive Rename Log
```

Columns:

| Column | Description |
|------|------|
Timestamp | Time of rename |
SharedDriveId | Drive where the change occurred |
ParentFolderId | Folder containing the file |
FileId | File identifier |
OldName | Original filename |
NewName | New filename |
NormalizedBaseName | Base filename used for grouping |
Extension | File extension |
CreatedTime | File creation timestamp |
FileLink | Direct link to the file |

---

# Example

Before upload conflict:

```
photo.jpg
photo.jpg
photo.jpg
```

After script execution:

```
photo.jpg
photo_0002.jpg
photo_0003.jpg
```

---

# Performance Notes

The script is designed for large drives:

- Initial cleanup runs once
- Continuous mode processes **only changed files**
- API usage remains low even with thousands of files

---

# Typical Use Cases

- Upload automation tools
- AI file processing pipelines
- Document ingestion workflows
- Design asset pipelines
- Image upload services
- Integration tools like **Filently**

---

# License

MIT License
