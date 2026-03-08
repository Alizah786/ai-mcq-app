CREATE OR ALTER PROCEDURE dbo.usp_Billing_GetPlans
  @Role NVARCHAR(20) = N'Teacher',
  @IncludeAll BIT = 0
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @hasDocumentUploadLimit BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'DocumentUploadLimit') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasPerQuizDocumentLimit BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'PerQuizDocumentLimit') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasMaxMcqsPerQuiz BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'MaxMcqsPerQuiz') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasFlashcardOtherGenerateLimit BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'FlashcardOtherGenerateLimit') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasAppliesToRole BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'AppliesToRole') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasAnalyticsLevel BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'AnalyticsLevel') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasLockHintForFreePlan BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'LockHintForFreePlan') IS NULL THEN 0 ELSE 1 END;
  DECLARE @hasLockPdfForFreePlan BIT = CASE WHEN COL_LENGTH('dbo.SubscriptionPlan', 'LockPdfForFreePlan') IS NULL THEN 0 ELSE 1 END;

  DECLARE @sql NVARCHAR(MAX) = N'
    SELECT
      PlanId,
      PlanName,
      Price,
      DurationDays,
      AIQuizLimit,
      ManualQuizLimit,
      IsActive, ' +
      CASE WHEN @hasDocumentUploadLimit = 1 THEN N'ISNULL(DocumentUploadLimit, 0)' ELSE N'CAST(0 AS INT)' END + N' AS DocumentUploadLimit, ' +
      CASE WHEN @hasPerQuizDocumentLimit = 1 THEN N'ISNULL(PerQuizDocumentLimit, 1)' ELSE N'CAST(1 AS INT)' END + N' AS PerQuizDocumentLimit, ' +
      CASE WHEN @hasMaxMcqsPerQuiz = 1 THEN N'ISNULL(MaxMcqsPerQuiz, 10)' ELSE N'CAST(10 AS INT)' END + N' AS MaxMcqsPerQuiz, ' +
      CASE WHEN @hasFlashcardOtherGenerateLimit = 1 THEN N'ISNULL(FlashcardOtherGenerateLimit, 0)' ELSE N'CAST(0 AS INT)' END + N' AS FlashcardOtherGenerateLimit, ' +
      CASE WHEN @hasAppliesToRole = 1 THEN N'ISNULL(AppliesToRole, ''Both'')' ELSE N'CAST(''Both'' AS NVARCHAR(20))' END + N' AS AppliesToRole, ' +
      CASE WHEN @hasAnalyticsLevel = 1 THEN N'ISNULL(AnalyticsLevel, ''Basic'')' ELSE N'CAST(''Basic'' AS NVARCHAR(20))' END + N' AS AnalyticsLevel, ' +
      CASE WHEN @hasLockHintForFreePlan = 1 THEN N'ISNULL(LockHintForFreePlan, 0)' ELSE N'CAST(0 AS BIT)' END + N' AS LockHintForFreePlan, ' +
      CASE WHEN @hasLockPdfForFreePlan = 1 THEN N'ISNULL(LockPdfForFreePlan, 0)' ELSE N'CAST(0 AS BIT)' END + N' AS LockPdfForFreePlan
    FROM dbo.SubscriptionPlan';

  IF @IncludeAll = 0
  BEGIN
    SET @sql += N'
      WHERE ' + CASE
        WHEN @hasAppliesToRole = 1 THEN N'ISNULL(AppliesToRole, ''Both'') IN (''Both'', @Role)'
        ELSE N'1 = 1'
      END;
  END

  SET @sql += N' ORDER BY PlanId;';

  EXEC sp_executesql
    @sql,
    N'@Role NVARCHAR(20)',
    @Role = @Role;
END;
GO
