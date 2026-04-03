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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Nickname).HasMaxLength(64).IsRequired();
            entity.Property(x => x.NormalizedNickname).HasMaxLength(64).IsRequired();
            entity.HasIndex(x => x.NormalizedNickname).IsUnique();
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
    }
}
