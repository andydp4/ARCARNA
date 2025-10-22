# Web Contact Picker Feature

## Overview
The Midnight EPOS customer creation form now includes a Web Contact Picker integration, allowing users to import contact information directly from their device's phonebook into the customer form.

## Implementation Details

### Location
`client/src/pages/customers.tsx`

### Features
- **One-Tap Import**: Users can import a single contact from their phonebook with one button click
- **Editable Data**: Imported contact data (name, email, phone) pre-fills the form but remains fully editable
- **Graceful Fallback**: Browser compatibility check with user-friendly error message for unsupported browsers
- **Auto-Save Integration**: Imported data is automatically saved to localStorage via the existing auto-save functionality
- **Mobile-Optimized**: Touch-friendly 44px minimum button height for easy mobile interaction

### Browser Support
The Web Contact Picker API is currently supported on:
- **Chrome/Edge (Android)**: Version 80+
- **Chrome/Edge (Desktop)**: Version 86+ with experimental flags
- **Not Supported**: Safari (iOS/macOS), Firefox

When the feature is unavailable, users see a toast notification: "Contact picker is not supported on this device or browser."

### How It Works

1. **User Action**: Click "Import from Contacts" button in the Add Customer dialog
2. **API Check**: System checks if `navigator.contacts` API is available
3. **Contact Selection**: Native contact picker opens (on supported devices)
4. **Data Import**: Selected contact's name, email, and phone are imported
5. **Form Pre-Fill**: Data populates the form fields
6. **Auto-Save**: Imported data is saved to localStorage
7. **User Editing**: User can edit any field before final submission
8. **Database Save**: Standard customer creation flow continues

### Code Structure

```typescript
// Browser API compatibility check
if (!('contacts' in navigator) || !('ContactsManager' in window)) {
  // Show not supported message
  return
}

// Request specific contact fields
const props = ['name', 'email', 'tel']
const opts = { multiple: false }
const contacts = await navigator.contacts.select(props, opts)

// Pre-fill form with imported data
const contact = contacts[0]
setFormData({
  ...formData,
  name: contact.name?.[0] || formData.name,
  email: contact.email?.[0] || formData.email,
  phone: contact.tel?.[0] || formData.phone,
})
```

### Security & Privacy
- **User Consent**: The browser's native contact picker requires explicit user permission
- **Single Contact**: Only one contact can be imported at a time
- **Specific Fields**: Only name, email, and phone are requested (no other contact data)
- **No Storage**: Contact data is only stored if the user completes the customer creation form
- **HTTPS Required**: The Web Contact Picker API only works over secure connections (HTTPS)

### Testing
The feature is best tested on:
1. **Android Mobile Device** with Chrome/Edge browser
2. **Desktop Chrome** (enable `chrome://flags/#contact-picker`)

#### Test Steps:
1. Navigate to Customers page
2. Click "Add Customer" button
3. In the dialog, click "Import from Contacts"
4. Select a contact from your phonebook
5. Verify name, email, and phone are pre-filled
6. Edit any field as needed
7. Click "Create Customer" to save

#### Expected Behavior on Unsupported Browsers:
1. Click "Import from Contacts"
2. See toast notification: "Contact picker is not supported on this device or browser"
3. Form remains empty and editable
4. User can manually enter customer information

### UI/UX Details
- **Button Location**: Directly below the dialog description, above form fields
- **Button Style**: Outline variant with Contact icon
- **Button Size**: Full width, 44px minimum height for touch accessibility
- **Visual Separator**: Border-bottom separator distinguishes import button from form
- **Toast Notifications**: 
  - Success: "Contact Imported - Contact data has been imported. You can edit it before saving."
  - Error: "Not Supported - Contact picker is not supported on this device or browser."
  - Failure: "Import Failed - Unable to import contact. Please try again."

### Integration with Existing Features
- **Auto-Save**: Imported data triggers the existing auto-save mechanism
- **Form Validation**: Standard name requirement still applies
- **Category Default**: Category remains at default "Bronze" (not imported)
- **Address Field**: Not imported from contacts (left empty for manual entry)
- **Edit Mode**: Import button only appears when creating new customers, not when editing

### Future Enhancements
Potential improvements for future versions:
- Multi-contact import for bulk customer creation
- Address field import (if available in contact data)
- Contact photo import for customer avatars
- Import history tracking
- Duplicate detection (check if contact already exists as customer)

## Technical Notes

### TypeScript Typing
The Contact Picker API is not yet in TypeScript's standard library definitions, so type casting is used:
```typescript
const contacts = await (navigator as any).contacts.select(props, opts)
```

### Error Handling
All contact picker operations are wrapped in try-catch blocks to handle:
- User cancellation (no contact selected)
- API unavailability
- Permission denial
- Network errors (rare on modern browsers)

### Data Fallback
The import function uses fallback values to preserve existing form data:
```typescript
name: contact.name?.[0] || formData.name
```
This ensures that if a contact field is empty, the form's current value is retained.

## Deployment Considerations
- **HTTPS Required**: Ensure production deployment uses HTTPS (Replit handles this automatically)
- **Mobile Testing**: Test thoroughly on actual mobile devices before production release
- **Feature Detection**: The built-in browser check ensures the feature degrades gracefully
- **No Backend Changes**: This is a pure frontend feature requiring no server modifications

## Documentation References
- [Web Contact Picker API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API)
- [Browser Compatibility - Can I Use](https://caniuse.com/contact-picker)
- [Specification - W3C](https://www.w3.org/TR/contact-picker/)

---

**Feature Added:** October 22, 2025  
**Implementation File:** `client/src/pages/customers.tsx`  
**Test ID:** `button-import-contact`
