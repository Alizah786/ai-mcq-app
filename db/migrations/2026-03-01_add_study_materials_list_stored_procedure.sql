CREATE OR ALTER PROCEDURE dbo.usp_StudyMaterials_ListByOwner
  @OwnerUserId INT
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @hasAssignments BIT = CASE WHEN COL_LENGTH('dbo.StudyMaterialVersion', 'AssignmentsJson') IS NULL THEN 0 ELSE 1 END;
  DECLARE @sql NVARCHAR(MAX) = N'
    SELECT
      s.StudyMaterialSetId,
      s.Subject,
      s.Topic,
      s.Status,
      s.OutputsJson,
      s.LatestVersionNo,
      s.CreatedAtUtc,
      s.UpdatedAtUtc,
      v.Title,
      v.SummaryText,
      v.KeywordsJson,
      v.NotesMarkdown,
      v.FlashcardsJson, ' +
      CASE WHEN @hasAssignments = 1 THEN N'v.AssignmentsJson' ELSE N'CAST(NULL AS NVARCHAR(MAX))' END + N' AS AssignmentsJson,
      v.IsUserEdited,
      v.CreatedAtUtc AS VersionCreatedAtUtc
    FROM dbo.StudyMaterialSet s
    OUTER APPLY (
      SELECT TOP 1
        VersionNo,
        Title,
        SummaryText,
        KeywordsJson,
        NotesMarkdown,
        FlashcardsJson, ' +
        CASE WHEN @hasAssignments = 1 THEN N'AssignmentsJson' ELSE N'CAST(NULL AS NVARCHAR(MAX))' END + N' AS AssignmentsJson,
        IsUserEdited,
        CreatedAtUtc
      FROM dbo.StudyMaterialVersion
      WHERE StudyMaterialSetId = s.StudyMaterialSetId
        AND VersionNo = s.LatestVersionNo
    ) v
    WHERE s.OwnerUserId = @OwnerUserId
    ORDER BY ISNULL(s.UpdatedAtUtc, s.CreatedAtUtc) DESC, s.StudyMaterialSetId DESC;';

  EXEC sp_executesql
    @sql,
    N'@OwnerUserId INT',
    @OwnerUserId = @OwnerUserId;
END;
GO
