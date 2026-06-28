# Project Management Dashboard Setup Guide

## Overview
A comprehensive project management system with admin controls, task management, real-time chat, and email notifications.

## Features
✅ **Admin Dashboard** - Manage users, boards, and tasks
✅ **Task Management** - Drag-and-drop Trello-like boards with status tracking
✅ **Login-only access** - Accounts are created by admins, not public signup
✅ **Real-time Chat** - Direct messages between any two users (not just admin), with image uploads
✅ **Email Notifications** - Automatic task assignment notifications via Resend
✅ **Role-based Access** - Admin vs Regular User permissions
✅ **Smooth Animations** - Polished UI with transitions and effects

## Database Setup

Core tables (see `scripts/` for the full migration history):
- `profiles` - User profiles with role management
- `boards` / `columns` - Project boards and their columns (To Do, In Progress, Done, etc.)
- `tasks` / `task_assignees` - Tasks, with multi-user assignment and per-task visibility ('assigned' vs 'board')
- `task_statuses` - Admin-managed status list (label/color), decoupled from board columns
- `task_attachments`, `task_comments`, `task_links` - Per-task files (stored as size-capped base64, not a storage bucket), comments, and links
- `tags` / `task_tags` - Board-scoped tags
- `chat_messages` - Chat between any users (not admin-only)
- `bookmarks`, `personal_tasks`, `marketing_calendar_items` - Supporting features (home-page bookmarks, private personal tasks, marketing calendar)
- Storage bucket `chat-attachments` for chat image uploads

## Initial Setup Steps

### 1. Configure Environment Variables
The following are automatically set by the Supabase integration:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` - required server-side by every admin route (create/update/delete user); never expose this to the client

Email notifications also require:
- `RESEND_API_KEY`
- `EMAIL_FROM`

### 2. Create the First Admin
Create the first admin in Supabase Auth, then make sure the matching row in `profiles` has `role = 'admin'`.

### 3. Add Team Members
Admins create additional users from the admin dashboard. Public self-service signup is disabled.

### 4. Email Notifications
Email notifications use Resend. When tasks are assigned, emails are sent from the configured `EMAIL_FROM` address.

## User Roles

### Admin
- Access to `/admin` dashboard
- Manage all users and their access
- Create and manage boards (including archiving - boards are never hard-deleted)
- Assign tasks to users, manage statuses
- View all tasks and boards, including archived ones
- Chat with any user

### Regular User
- Access to `/dashboard`
- View all active boards (board access isn't restricted per-user) and any task assigned to them or marked visible to the whole board
- Update task status; can only change a task's due date if they created it
- Chat with any other user, not just admins

## Usage Flow

1. **Admin logs in** at `/login`
2. **Admin adds more users** via Admin Dashboard → Users
3. **Admin creates boards** for different projects
4. **Admin creates tasks** and assigns them to users
5. **Email sent automatically** to assigned user
6. **Users log in** and see their tasks
7. **Users update status** by dragging tasks between columns
8. **Admin and users communicate** via real-time chat

## Key Pages

- `/` - Landing page
- `/login` - Login page
- `/admin` - Admin dashboard
- `/admin/board/[id]` - Admin board view with full controls
- `/dashboard` - User dashboard
- `/dashboard/board/[id]` - User board view (all active boards are visible; per-task visibility still applies)

## Security Features

- Row Level Security (RLS) on every table
- Public signup disabled; admin user-management routes require an authenticated admin session
- Role-based access control
- File uploads are size-capped at the database level (chat images go through Supabase Storage; task attachments are validated base64 with a server-enforced size limit)
- Route protection is server-side per page (`auth.getUser()` + redirect in each protected page) - there is no Next.js Middleware in this project
- Security headers (CSP, X-Frame-Options, etc.) applied in production via `next.config.mjs`

## Customization

### Adding More Columns
Edit the board to add custom columns (e.g., "Testing", "Review")

### Task Priorities
Tasks support numeric priorities from 1 to 5.

### Task Status
Default statuses: To Do, In Progress, Done. Admins can create or archive additional statuses.

## Support

For issues or questions, refer to the Supabase documentation or check the RLS policies in the database.
