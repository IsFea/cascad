using Cascad.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Services;

public sealed class DatabaseSchemaUpgrader : IDatabaseSchemaUpgrader
{
    private readonly AppDbContext _db;

    public DatabaseSchemaUpgrader(AppDbContext db)
    {
        _db = db;
    }

    public async Task UpgradeAsync(CancellationToken cancellationToken = default)
    {
        if (!_db.Database.IsRelational())
        {
            return;
        }

        // Keep compatibility with early MVP databases created via EnsureCreated.
        await _db.Database.ExecuteSqlRawAsync(
            """
            ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "PasswordHash" character varying(512) NOT NULL DEFAULT '';
            ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "Status" integer NOT NULL DEFAULT 1;
            ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "PlatformRole" integer NOT NULL DEFAULT 0;
            ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "AvatarUrl" character varying(300);

            CREATE TABLE IF NOT EXISTS "Workspaces" (
                "Id" uuid NOT NULL,
                "Name" character varying(100) NOT NULL,
                "CreatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_Workspaces" PRIMARY KEY ("Id")
            );

            CREATE TABLE IF NOT EXISTS "WorkspaceMembers" (
                "WorkspaceId" uuid NOT NULL,
                "UserId" uuid NOT NULL,
                "Role" integer NOT NULL,
                "JoinedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_WorkspaceMembers" PRIMARY KEY ("WorkspaceId", "UserId"),
                CONSTRAINT "FK_WorkspaceMembers_Workspaces_WorkspaceId" FOREIGN KEY ("WorkspaceId") REFERENCES "Workspaces" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_WorkspaceMembers_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "Channels" (
                "Id" uuid NOT NULL,
                "WorkspaceId" uuid NOT NULL,
                "Name" character varying(100) NOT NULL,
                "Type" integer NOT NULL,
                "Position" integer NOT NULL,
                "MaxParticipants" integer NULL,
                "MaxConcurrentStreams" integer NULL,
                "LiveKitRoomName" character varying(120) NULL,
                "CreatedByUserId" uuid NOT NULL,
                "CreatedAtUtc" timestamp with time zone NOT NULL,
                "IsDeleted" boolean NOT NULL,
                CONSTRAINT "PK_Channels" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_Channels_Workspaces_WorkspaceId" FOREIGN KEY ("WorkspaceId") REFERENCES "Workspaces" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_Channels_Users_CreatedByUserId" FOREIGN KEY ("CreatedByUserId") REFERENCES "Users" ("Id") ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS "VoiceSessions" (
                "ChannelId" uuid NOT NULL,
                "UserId" uuid NOT NULL,
                "IsMuted" boolean NOT NULL,
                "IsDeafened" boolean NOT NULL,
                "SessionInstanceId" character varying(80) NOT NULL,
                "TabInstanceId" character varying(80) NOT NULL,
                "ConnectedAtUtc" timestamp with time zone NOT NULL,
                "LastSeenAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_VoiceSessions" PRIMARY KEY ("ChannelId", "UserId"),
                CONSTRAINT "FK_VoiceSessions_Channels_ChannelId" FOREIGN KEY ("ChannelId") REFERENCES "Channels" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_VoiceSessions_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            ALTER TABLE "VoiceSessions" ADD COLUMN IF NOT EXISTS "SessionInstanceId" character varying(80) NOT NULL DEFAULT '';
            ALTER TABLE "VoiceSessions" ADD COLUMN IF NOT EXISTS "TabInstanceId" character varying(80) NOT NULL DEFAULT '';

            CREATE TABLE IF NOT EXISTS "VoiceModerationStates" (
                "WorkspaceId" uuid NOT NULL,
                "UserId" uuid NOT NULL,
                "IsServerMuted" boolean NOT NULL,
                "IsServerDeafened" boolean NOT NULL,
                "UpdatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_VoiceModerationStates" PRIMARY KEY ("WorkspaceId", "UserId"),
                CONSTRAINT "FK_VoiceModerationStates_Workspaces_WorkspaceId" FOREIGN KEY ("WorkspaceId") REFERENCES "Workspaces" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_VoiceModerationStates_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "VoiceStreamPublications" (
                "ChannelId" uuid NOT NULL,
                "UserId" uuid NOT NULL,
                "IsActive" boolean NOT NULL,
                "StartedAtUtc" timestamp with time zone NOT NULL,
                "LastSeenAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_VoiceStreamPublications" PRIMARY KEY ("ChannelId", "UserId"),
                CONSTRAINT "FK_VoiceStreamPublications_Channels_ChannelId" FOREIGN KEY ("ChannelId") REFERENCES "Channels" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_VoiceStreamPublications_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "ChannelMessages" (
                "Id" uuid NOT NULL,
                "WorkspaceId" uuid NOT NULL,
                "ChannelId" uuid NOT NULL,
                "UserId" uuid NOT NULL,
                "ClientMessageId" uuid NULL,
                "Content" character varying(5000) NOT NULL,
                "CreatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_ChannelMessages" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_ChannelMessages_Workspaces_WorkspaceId" FOREIGN KEY ("WorkspaceId") REFERENCES "Workspaces" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ChannelMessages_Channels_ChannelId" FOREIGN KEY ("ChannelId") REFERENCES "Channels" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_ChannelMessages_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "MessageAttachments" (
                "Id" uuid NOT NULL,
                "MessageId" uuid NOT NULL,
                "OriginalFileName" character varying(200) NOT NULL,
                "ContentType" character varying(120) NOT NULL,
                "FileSizeBytes" bigint NOT NULL,
                "UrlPath" character varying(400) NOT NULL,
                "CreatedAtUtc" timestamp with time zone NOT NULL,
                CONSTRAINT "PK_MessageAttachments" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_MessageAttachments_ChannelMessages_MessageId" FOREIGN KEY ("MessageId") REFERENCES "ChannelMessages" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "MessageMentions" (
                "MessageId" uuid NOT NULL,
                "MentionedUserId" uuid NOT NULL,
                "MentionToken" character varying(64) NOT NULL,
                CONSTRAINT "PK_MessageMentions" PRIMARY KEY ("MessageId", "MentionedUserId"),
                CONSTRAINT "FK_MessageMentions_ChannelMessages_MessageId" FOREIGN KEY ("MessageId") REFERENCES "ChannelMessages" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_MessageMentions_Users_MentionedUserId" FOREIGN KEY ("MentionedUserId") REFERENCES "Users" ("Id") ON DELETE CASCADE
            );

            ALTER TABLE "ChannelMessages" ADD COLUMN IF NOT EXISTS "ClientMessageId" uuid;
            ALTER TABLE "MessageMentions" ADD COLUMN IF NOT EXISTS "MentionToken" character varying(64) NOT NULL DEFAULT '';

            CREATE INDEX IF NOT EXISTS "IX_WorkspaceMembers_UserId" ON "WorkspaceMembers" ("UserId");
            CREATE INDEX IF NOT EXISTS "IX_Channels_WorkspaceId_Position" ON "Channels" ("WorkspaceId", "Position");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Channels_LiveKitRoomName" ON "Channels" ("LiveKitRoomName") WHERE "LiveKitRoomName" IS NOT NULL;
            CREATE INDEX IF NOT EXISTS "IX_VoiceSessions_UserId" ON "VoiceSessions" ("UserId");
            CREATE INDEX IF NOT EXISTS "IX_VoiceModerationStates_UserId" ON "VoiceModerationStates" ("UserId");
            CREATE INDEX IF NOT EXISTS "IX_VoiceStreamPublications_LastSeenAtUtc" ON "VoiceStreamPublications" ("LastSeenAtUtc");
            CREATE INDEX IF NOT EXISTS "IX_ChannelMessages_ChannelId_CreatedAtUtc" ON "ChannelMessages" ("ChannelId", "CreatedAtUtc");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ChannelMessages_ChannelId_UserId_ClientMessageId"
                ON "ChannelMessages" ("ChannelId", "UserId", "ClientMessageId")
                WHERE "ClientMessageId" IS NOT NULL;
            CREATE INDEX IF NOT EXISTS "IX_MessageAttachments_MessageId" ON "MessageAttachments" ("MessageId");
            CREATE INDEX IF NOT EXISTS "IX_MessageMentions_MentionedUserId" ON "MessageMentions" ("MentionedUserId");
            """,
            cancellationToken);
    }
}
