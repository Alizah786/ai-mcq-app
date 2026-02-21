/*
  Migration: Add disclaimer acknowledgment flag on quiz attempts
  Date: 2026-02-16

  Adds:
    - dbo.QuizAttempt.DisclaimerAcknowledgment BIT NOT NULL DEFAULT(0)

  Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF COL_LENGTH('dbo.QuizAttempt', 'DisclaimerAcknowledgment') IS NULL
  BEGIN
    ALTER TABLE dbo.QuizAttempt
    ADD DisclaimerAcknowledgment BIT NOT NULL
      CONSTRAINT DF_QuizAttempt_DisclaimerAcknowledgment DEFAULT (0);
  END

  COMMIT;
  PRINT 'SUCCESS: DisclaimerAcknowledgment ensured on dbo.QuizAttempt.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
GO

