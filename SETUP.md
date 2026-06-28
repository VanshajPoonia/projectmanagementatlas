# Project Management Dashboard Setup Guide

## Overview
A comprehensive project management system with admin controls, task management, real-time chat, and email notifications.

## Features
✅ **Admin Dashboard** - Manage users, boards, and tasks
✅ **Task Management** - Drag-and-drop Trello-like boards with status tracking
✅ **Login-only access** - Accounts are created by admins, not public signup
✅ **Real-time Chat** - Chat between admin and users with image uploads
✅ **Email Notifications** - Automatic task assignment notifications via Resend
✅ **Role-based Access** - Admin vs Regular User permissions
✅ **Smooth Animations** - Polished UI with transitions and effects

## Database Setup

The database has been set up with the following tables:
- `profiles` - User profiles with role management
- `boards` - Project boards
- `columns` - Board columns (To Do, In Progress, Done, etc.)
- `tasks` - Tasks with assignments and priorities
- `chat_messages` - Chat messages between users and admin
- Storage bucket `chat-attachments` for file uploads

## Initial Setup Steps

### 1. Configure Environment Variables
The following are automatically set by Supabase integration:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL`

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
- Create and manage boards
- Assign tasks to users
- View all tasks and boards
- Chat with all users

### Regular User
- Access to `/dashboard`
- View assigned tasks
- Update task status
- View boards they're assigned to
- Chat with admin

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
- `/dashboard/board/[id]` - User board view (their tasks only)

## Security Features

- Row Level Security (RLS) on all tables
- Public signup disabled
- Role-based access control
- Secure file uploads with proper permissions
- Middleware for route protection

## Customization

### Adding More Columns
Edit the board to add custom columns (e.g., "Testing", "Review")

### Task Priorities
Tasks support numeric priorities from 1 to 5.

### Task Status
Default statuses: To Do, In Progress, Done. Admins can create or archive additional statuses.

## Support

For issues or questions, refer to the Supabase documentation or check the RLS policies in the database.
