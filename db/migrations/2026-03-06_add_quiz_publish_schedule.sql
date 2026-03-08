SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF COL_LENGTH('dbo.Quiz', 'PublishStartUtc') IS NULL
BEGIN
  ALTER TABLE dbo.Quiz
    ADD PublishStartUtc DATETIME2(0) NULL;
END;
GO

IF COL_LENGTH('dbo.Quiz', 'PublishEndUtc') IS NULL
BEGIN
  ALTER TABLE dbo.Quiz
    ADD PublishEndUtc DATETIME2(0) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_Quiz_Status_PublishWindow'
    AND object_id = OBJECT_ID('dbo.Quiz')
)
BEGIN
  CREATE INDEX IX_Quiz_Status_PublishWindow
    ON dbo.Quiz (Status, PublishStartUtc, PublishEndUtc, QuizId);
END;
GO
