/*
  Migration: Ensure system fallback manager exists
  Date: 2026-02-16

  Purpose:
    - Pre-create a non-login system manager used for direct student signups
      when no real manager is involved.
    - Safe to run multiple times.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID('dbo.Manager', 'U') IS NULL
  BEGIN
    RAISERROR('dbo.Manager table is required before running this script.', 16, 1);
  END

  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Manager
    WHERE Email = 'system-fallback-manager@local'
  )
  BEGIN
    INSERT INTO dbo.Manager (Email, FullName, PasswordHash, IsActive, QuizLimit)
    VALUES (
      'system-fallback-manager@local',
      'System Fallback Manager',
      'SYSTEM_DISABLED_MANUAL',
      0,
      40
    );
  END

  COMMIT;
  PRINT 'SUCCESS: System fallback manager ensured.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;

  DECLARE @Err NVARCHAR(4000) = ERROR_MESSAGE();
  DECLARE @Line INT = ERROR_LINE();
  DECLARE @Num INT = ERROR_NUMBER();
  RAISERROR('FAILED (Err %d at line %d): %s', 16, 1, @Num, @Line, @Err);
END CATCH;
GO

