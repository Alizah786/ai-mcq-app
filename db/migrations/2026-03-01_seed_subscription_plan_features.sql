SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.SubscriptionPlanFeature', 'U') IS NULL
BEGIN
  RAISERROR('dbo.SubscriptionPlanFeature does not exist. Run 2026-03-01_add_subscription_plan_features_table.sql first.', 16, 1);
  RETURN;
END;
GO

;WITH PlanTargets AS (
    SELECT PlanId, PlanName
    FROM dbo.SubscriptionPlan
    WHERE LOWER(PlanName) IN (
        LOWER('Student Free Trial'),
        LOWER('Student Basic'),
        LOWER('Student Pro'),
        LOWER('Free Trial'),
        LOWER('Basic Teacher Plan'),
        LOWER('Pro Teacher Plan')
    )
)
DELETE f
FROM dbo.SubscriptionPlanFeature f
JOIN PlanTargets p
    ON p.PlanId = f.PlanId;
GO

INSERT INTO dbo.SubscriptionPlanFeature
    (PlanId, DisplayOrder, FeatureText, IsActive, CreatedAtUtc, UpdatedAtUtc)
SELECT
    p.PlanId,
    v.DisplayOrder,
    v.FeatureText,
    1,
    SYSUTCDATETIME(),
    SYSUTCDATETIME()
FROM dbo.SubscriptionPlan p
JOIN (VALUES
    ('Student Free Trial', 1, '1 class'),
    ('Student Free Trial', 2, 'Practice quizzes'),
    ('Student Free Trial', 3, 'Limited AI quiz generation'),
    ('Student Free Trial', 4, 'Starter flashcards'),
    ('Student Free Trial', 5, 'Teacher-assigned quizzes'),
    ('Student Free Trial', 6, 'Watermarked export'),

    ('Student Basic', 1, 'Up to 3 classes'),
    ('Student Basic', 2, 'AI quiz generation'),
    ('Student Basic', 3, 'Notes and flashcards'),
    ('Student Basic', 4, 'Document-based quiz generation'),
    ('Student Basic', 5, 'Exam practice mode'),
    ('Student Basic', 6, 'Clean PDF export'),

    ('Student Pro', 1, 'Up to 5 classes'),
    ('Student Pro', 2, 'Higher AI limits'),
    ('Student Pro', 3, 'Faster AI generation'),
    ('Student Pro', 4, 'Advanced notes and flashcards'),
    ('Student Pro', 5, 'Advanced document quiz generation'),
    ('Student Pro', 6, 'Priority processing'),

    ('Free Trial', 1, 'Basic class management'),
    ('Free Trial', 2, 'Practice quizzes'),
    ('Free Trial', 3, 'Limited AI generation'),
    ('Free Trial', 4, 'Limited student tracking'),
    ('Free Trial', 5, 'Starter flashcards and notes'),
    ('Free Trial', 6, 'Watermarked export'),

    ('Basic Teacher Plan', 1, 'Manage multiple classes'),
    ('Basic Teacher Plan', 2, 'AI quiz and assessment creation'),
    ('Basic Teacher Plan', 3, 'Student tracking'),
    ('Basic Teacher Plan', 4, 'Question import'),
    ('Basic Teacher Plan', 5, 'Notes and flashcards'),
    ('Basic Teacher Plan', 6, 'Document quiz generation'),

    ('Pro Teacher Plan', 1, 'All Basic features'),
    ('Pro Teacher Plan', 2, 'Higher classroom capacity'),
    ('Pro Teacher Plan', 3, 'Advanced analytics'),
    ('Pro Teacher Plan', 4, 'Priority AI generation'),
    ('Pro Teacher Plan', 5, 'Batch quiz creation'),
    ('Pro Teacher Plan', 6, 'Advanced student reports')
) v(PlanName, DisplayOrder, FeatureText)
    ON LOWER(p.PlanName) = LOWER(v.PlanName);
GO
