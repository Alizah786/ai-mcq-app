/*
  Migration: Add TimeLimitMinutes to dbo.Quiz
  Date: 2026-02-25

  Adds:
    - dbo.Quiz.TimeLimitMinutes INT NOT NULL DEFAULT(0)
    - CHECK constraint to enforce range 0..300

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.Quiz', 'U') IS NULL
  BEGIN
    THROW 50000, 'Table dbo.Quiz does not exist.', 1;
  END

  IF COL_LENGTH('dbo.Quiz', 'TimeLimitMinutes') IS NULL
  BEGIN
    ALTER TABLE dbo.Quiz
    ADD TimeLimitMinutes INT NOT NULL
      CONSTRAINT DF_Quiz_TimeLimitMinutes DEFAULT (0);
  END

  UPDATE dbo.Quiz
  SET TimeLimitMinutes = 0
  WHERE TimeLimitMinutes IS NULL OR TimeLimitMinutes < 0;

  UPDATE dbo.Quiz
  SET TimeLimitMinutes = 300
  WHERE TimeLimitMinutes > 300;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Quiz_TimeLimitMinutes_Range'
      AND parent_object_id = OBJECT_ID('dbo.Quiz')
  )
  BEGIN
    ALTER TABLE dbo.Quiz
    ADD CONSTRAINT CK_Quiz_TimeLimitMinutes_Range
      CHECK (TimeLimitMinutes BETWEEN 0 AND 300);
  END

  COMMIT;
  PRINT 'SUCCESS: TimeLimitMinutes ensured on dbo.Quiz.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

