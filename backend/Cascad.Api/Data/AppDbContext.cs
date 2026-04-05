using Cascad.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Cascad.Api.Data;

public sealed class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options)
    {
    }

    public DbSet<AppUser> Users => Set<AppUser>();

    public DbSet<Room> Rooms => Set<Room>();

    public DbSet<RoomInvite> RoomInvites => Set<RoomInvite>();

    public DbSet<RoomPresence> RoomPresences => Set<RoomPresence>();

    public DbSet<Workspace> Workspaces => Set<Workspace>();

    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();

    public DbSet<Channel> Channels => Set<Channel>();

    public DbSet<VoiceSession> VoiceSessions => Set<VoiceSession>();

    public DbSet<VoiceModerationState> VoiceModerationStates => Set<VoiceModerationState>();

    public DbSet<VoiceStreamPublication> VoiceStreamPublications => Set<VoiceStreamPublication>();

    public DbSet<ChannelMessage> ChannelMessages => Set<ChannelMessage>();

    public DbSet<ChannelReadState> ChannelReadStates => Set<ChannelReadState>();

    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();

    public DbSet<MessageMention> MessageMentions => Set<MessageMention>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Username).HasColumnName("Nickname").HasMaxLength(64).IsRequired();
            entity.Property(x => x.NormalizedUsername)
                .HasColumnName("NormalizedNickname")
                .HasMaxLength(64)
                .IsRequired();
            entity.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
            entity.Property(x => x.AvatarUrl).HasMaxLength(300);
            entity.HasIndex(x => x.NormalizedUsername).IsUnique();
        });

        modelBuilder.Entity<Room>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(80).IsRequired();
            entity.Property(x => x.LiveKitRoomName).HasMaxLength(100).IsRequired();
            entity.HasIndex(x => x.LiveKitRoomName).IsUnique();

            entity.HasOne(x => x.OwnerUser)
                .WithMany(x => x.OwnedRooms)
                .HasForeignKey(x => x.OwnerUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RoomInvite>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.TokenHash).HasMaxLength(86).IsRequired();
            entity.HasIndex(x => x.TokenHash).IsUnique();

            entity.HasOne(x => x.Room)
                .WithMany(x => x.Invites)
                .HasForeignKey(x => x.RoomId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.CreatedByUser)
                .WithMany(x => x.CreatedInvites)
                .HasForeignKey(x => x.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RoomPresence>(entity =>
        {
            entity.HasKey(x => new { x.RoomId, x.UserId });

            entity.HasOne(x => x.Room)
                .WithMany(x => x.Presences)
                .HasForeignKey(x => x.RoomId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany(x => x.RoomPresences)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Workspace>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(100).IsRequired();
        });

        modelBuilder.Entity<WorkspaceMember>(entity =>
        {
            entity.HasKey(x => new { x.WorkspaceId, x.UserId });

            entity.HasOne(x => x.Workspace)
                .WithMany(x => x.Members)
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany(x => x.WorkspaceMemberships)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Channel>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(100).IsRequired();
            entity.Property(x => x.LiveKitRoomName).HasMaxLength(120);
            entity.HasIndex(x => new { x.WorkspaceId, x.Position });

            entity.HasOne(x => x.Workspace)
                .WithMany(x => x.Channels)
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.CreatedByUser)
                .WithMany()
                .HasForeignKey(x => x.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<VoiceSession>(entity =>
        {
            entity.HasKey(x => new { x.ChannelId, x.UserId });
            entity.HasIndex(x => x.UserId);
            entity.Property(x => x.SessionInstanceId).HasMaxLength(80).IsRequired();
            entity.Property(x => x.TabInstanceId).HasMaxLength(80).IsRequired();

            entity.HasOne(x => x.Channel)
                .WithMany(x => x.VoiceSessions)
                .HasForeignKey(x => x.ChannelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany(x => x.VoiceSessions)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<VoiceModerationState>(entity =>
        {
            entity.HasKey(x => new { x.WorkspaceId, x.UserId });
            entity.HasIndex(x => x.UserId);

            entity.HasOne(x => x.Workspace)
                .WithMany(x => x.VoiceModerationStates)
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany(x => x.VoiceModerationStates)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<VoiceStreamPublication>(entity =>
        {
            entity.HasKey(x => new { x.ChannelId, x.UserId });
            entity.HasIndex(x => x.LastSeenAtUtc);

            entity.HasOne(x => x.Channel)
                .WithMany(x => x.StreamPublications)
                .HasForeignKey(x => x.ChannelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany(x => x.StreamPublications)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChannelMessage>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).HasMaxLength(5000).IsRequired();
            entity.HasIndex(x => new { x.ChannelId, x.CreatedAtUtc });
            entity.HasIndex(x => new { x.ChannelId, x.UserId, x.ClientMessageId })
                .IsUnique()
                .HasFilter("\"ClientMessageId\" IS NOT NULL");

            entity.HasOne(x => x.Workspace)
                .WithMany()
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Channel)
                .WithMany(x => x.Messages)
                .HasForeignKey(x => x.ChannelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany(x => x.Messages)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChannelReadState>(entity =>
        {
            entity.HasKey(x => new { x.WorkspaceId, x.ChannelId, x.UserId });
            entity.HasIndex(x => new { x.UserId, x.WorkspaceId });
            entity.HasIndex(x => new { x.ChannelId, x.UserId });

            entity.HasOne(x => x.Workspace)
                .WithMany()
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Channel)
                .WithMany()
                .HasForeignKey(x => x.ChannelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MessageAttachment>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.OriginalFileName).HasMaxLength(200).IsRequired();
            entity.Property(x => x.ContentType).HasMaxLength(120).IsRequired();
            entity.Property(x => x.UrlPath).HasMaxLength(400).IsRequired();

            entity.HasOne(x => x.Message)
                .WithMany(x => x.Attachments)
                .HasForeignKey(x => x.MessageId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MessageMention>(entity =>
        {
            entity.HasKey(x => new { x.MessageId, x.MentionedUserId });
            entity.HasIndex(x => x.MentionedUserId);
            entity.Property(x => x.MentionToken).HasMaxLength(64).IsRequired();

            entity.HasOne(x => x.Message)
                .WithMany(x => x.Mentions)
                .HasForeignKey(x => x.MessageId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.MentionedUser)
                .WithMany(x => x.Mentions)
                .HasForeignKey(x => x.MentionedUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
