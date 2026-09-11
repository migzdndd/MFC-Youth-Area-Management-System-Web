# MFC Youth Area Management System - Web

A web-based version of the **MFC Youth Area Management System**, designed to provide responsive access to Area records, members, chapters, services, activity reports, events, participants, and related information.

This project is currently under active development and is not yet intended for production use with real member data.

---

## Current Status

**Stage:** Frontend Prototype / Development

The frontend is currently deployed through **Vercel** and connected to the GitHub repository.

Current production URL:

https://mfc-youth-area-management-system.vercel.app

The project is still using browser-based storage for prototype functionality. A secure backend, production authentication, cloud database, and synchronization system will be implemented in later development phases.

---

## How to Run Locally

1. Clone or download the repository.
2. Keep the project files and folders in their existing structure.
3. Open the `Frontend` folder.
4. Open `index.html` using a browser or VS Code Live Server.

For development, VS Code Live Server is recommended.

---

## Current Features

### Authentication UI
- Sign In page
- Sign Up page
- Account Recovery page
- Frontend session handling
- Authentication interface prepared for future backend integration

### Dashboard
- Area summary
- Total member count
- Chapter count
- Service count
- Activity report count
- Event count
- Members by chapter overview
- Recent events

### Members
- Add members
- Edit members
- Delete members
- Search members
- Assign chapters
- Assign services
- Member status
- Contact information
- GIG contribution tracking

### Chapters
- Add chapters
- Rename chapters
- Delete chapters
- View chapter members

### Services
Includes the seven built-in MFC Youth service roles:

- Unit Servant
- Household Servant
- Chapter Servant
- Area Servant
- LIT Servant
- Campus Servant
- MFC High Servant

### Activity Reports
- Create reports
- Edit reports
- Delete reports
- Search and filter reports
- Chapter filtering
- Report type filtering
- Monthly statistics
- Basic analytics
- Print / Export to PDF through the browser

### Events
- Create events
- Edit events
- Delete events
- Participant registration
- Payment tracking
- Attendance tracking

### User Interface
- Responsive desktop layout
- Mobile-friendly layout
- Sidebar navigation
- Modal forms
- Notifications
- Empty states
- Search and filtering
- Responsive tables and forms

---

## Current Data Storage

The current web prototype uses the browser's `localStorage` for temporary development data.

This includes prototype records such as:

- Members
- Chapters
- Services
- Events
- Participants
- Activity Reports
- GIG Contributions
- Development sessions

Because `localStorage` is client-side storage, it must **not be treated as a secure production database**.

Data is stored separately inside each browser/device and is not currently synchronized between users.

---

## Security Notice

This project is currently a development prototype.

**Do not use real or sensitive MFC Youth member information in the current deployed version.**

Production deployment will require:

- Secure backend authentication
- Password hashing
- Secure session management
- Server-side authorization
- Role-based access control
- Area-based data isolation
- Server-side input validation
- Rate limiting
- Security headers
- Secure environment variables
- Cloud database access controls
- Audit logging
- Backup and recovery
- Protection against common web vulnerabilities

The frontend should never contain database passwords, private API keys, service-role keys, or other sensitive credentials.

---

## Planned Architecture

The long-term system is intended to support both online and offline use.

```text
Web Application
      |
      | HTTPS
      v
Secure Backend / API
      |
      v
Cloud Database
      ^
      |
      | Synchronization
      |
Windows Desktop Application
      |
      v
Local SQLite Database
