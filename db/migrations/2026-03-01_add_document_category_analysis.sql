IF COL_LENGTH('dbo.DocumentUpload', 'DetectedDocType') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD DetectedDocType NVARCHAR(50) NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'DetectConfidence') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD DetectConfidence DECIMAL(4,3) NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'CategoryScoresJson') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD CategoryScoresJson NVARCHAR(MAX) NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'SuggestedCategory') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD SuggestedCategory NVARCHAR(30) NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'AnalysisReasonsJson') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD AnalysisReasonsJson NVARCHAR(MAX) NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'AnalyzedAtUtc') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD AnalyzedAtUtc DATETIME2 NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'UserChosenCategory') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD UserChosenCategory NVARCHAR(30) NULL;

IF COL_LENGTH('dbo.DocumentUpload', 'UserOverrodeSuggestion') IS NULL
  ALTER TABLE dbo.DocumentUpload ADD UserOverrodeSuggestion BIT NOT NULL CONSTRAINT DF_DocumentUpload_UserOverrodeSuggestion DEFAULT(0);

