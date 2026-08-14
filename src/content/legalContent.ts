export interface LegalSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export const LEGAL_CONTACT = {
  company: 'Never Leave Bros Behind (NLBB)',
  email: 'support@nlbb.co.ke',
  website: 'https://nlbb.co.ke',
  privacyUrl: 'https://api.nlbb.co.ke/legal/privacy',
  termsUrl: 'https://api.nlbb.co.ke/legal/terms',
  deleteAccountUrl: 'https://api.nlbb.co.ke/legal/delete-account',
};

export const TERMS_LAST_UPDATED = 'July 2026';
export const PRIVACY_LAST_UPDATED = 'August 2026';
export const DELETE_ACCOUNT_LAST_UPDATED = 'August 2026';

export const ACCOUNT_DELETION_MAILTO = `mailto:${LEGAL_CONTACT.email}?subject=${encodeURIComponent(
  'NLBB account deletion request'
)}&body=${encodeURIComponent(
  'Please delete my Never Leave Bros Behind (NLBB) account and associated personal data.\n\nRegistered email:\nPhone (if known):\nRole (customer or provider):\n\nI understand this request is permanent.'
)}`;

export const TERMS_OF_SERVICE_SECTIONS: LegalSection[] = [
  {
    title: '1. About NLBB',
    paragraphs: [
      'Never Leave Bros Behind ("NLBB", "we", "us", or "our") operates a mobile marketplace that connects customers with beauty, grooming, and wellness service providers in Kenya.',
      'By creating an account, browsing as a guest where permitted, or using any NLBB feature, you agree to these Terms of Service. If you do not agree, please do not use the app.',
    ],
  },
  {
    title: '2. Eligibility',
    paragraphs: [
      'You must be at least 18 years old to create an account. By registering, you confirm that the information you provide is accurate and that you have authority to accept these terms on your own behalf or on behalf of a business you represent.',
    ],
  },
  {
    title: '3. Accounts and roles',
    paragraphs: [
      'NLBB supports customer and provider accounts. Customers may browse providers, save favorites, book appointments, leave reviews, and contact providers after signing in.',
      'Providers may list a business, manage services and availability, receive bookings, and maintain a paid subscription to remain visible to customers. You are responsible for keeping your login credentials secure and for all activity under your account.',
    ],
  },
  {
    title: '4. Bookings and service delivery',
    paragraphs: [
      'NLBB helps customers discover providers and request appointments. The actual service is delivered by the independent provider you choose, not by NLBB.',
      'Appointment times, pricing, cancellations, and service quality are agreed between you and the provider. NLBB does not guarantee availability, punctuality, or the outcome of any service.',
    ],
    bullets: [
      'You agree to provide accurate booking details, including your name and contact information.',
      'Providers may confirm, reschedule, or decline bookings according to their availability and business policies.',
      'Repeated no-shows, abuse, or harassment may result in account suspension.',
    ],
  },
  {
    title: '5. Payments',
    paragraphs: [
      'Unless clearly stated otherwise in the app, service fees are paid directly to the provider at the venue. NLBB does not add booking fees for customers through the app.',
      'Providers may be required to pay a recurring subscription through M-Pesa to keep their listing active. Subscription charges, renewal timing, and visibility rules are shown in the provider area of the app.',
      'Any payment disputes relating to services received should first be raised with the provider. NLBB may assist with platform-related billing issues where applicable.',
    ],
  },
  {
    title: '6. Provider listings and content',
    paragraphs: [
      'Providers are responsible for the accuracy of business names, descriptions, prices, photos, contact details, opening hours, and service listings they publish.',
      'By submitting content to NLBB, you grant us a non-exclusive licence to display, store, and promote that content within the platform for as long as your listing remains active.',
      'We may remove or suspend listings that are misleading, unlawful, offensive, infringe third-party rights, or violate these terms.',
    ],
  },
  {
    title: '7. Reviews and communications',
    paragraphs: [
      'Customers may leave reviews after completed bookings. Reviews must be honest, relevant, and respectful. We may remove reviews that are fraudulent, defamatory, or otherwise inappropriate.',
      'When you book or communicate through NLBB, necessary contact details may be shared between customer and provider so appointments can be managed.',
    ],
  },
  {
    title: '8. Acceptable use',
    paragraphs: ['You agree not to misuse the platform. Prohibited conduct includes:'],
    bullets: [
      'Creating fake accounts, fake bookings, or fake reviews.',
      'Harassing, threatening, or discriminating against other users.',
      'Attempting to bypass security, scrape data, or interfere with app operations.',
      'Using NLBB for unlawful, fraudulent, or harmful activity.',
    ],
  },
  {
    title: '9. Suspension and termination',
    paragraphs: [
      'We may suspend or terminate access to NLBB if you breach these terms, create risk for other users, or if required by law. You may stop using the app at any time and delete your account from Profile settings in the mobile app.',
      'Sections that by nature should survive termination, including limitations of liability and dispute provisions, will continue to apply.',
    ],
  },
  {
    title: '10. Disclaimers and liability',
    paragraphs: [
      'NLBB is provided on an "as is" and "as available" basis. To the fullest extent permitted by Kenyan law, NLBB is not liable for indirect, incidental, or consequential losses arising from your use of the platform or from services delivered by providers.',
      'Our total liability for any claim relating to the platform will not exceed the amount you paid to NLBB, if any, in the three months before the claim arose.',
    ],
  },
  {
    title: '11. Changes to these terms',
    paragraphs: [
      'We may update these Terms of Service from time to time. Material changes will be reflected in the app with an updated date. Continued use of NLBB after changes take effect means you accept the revised terms.',
    ],
  },
  {
    title: '12. Governing law and contact',
    paragraphs: [
      'These terms are governed by the laws of Kenya. Disputes should first be raised with us at support@nlbb.co.ke so we can try to resolve them informally.',
      `Questions about these terms may be sent to ${LEGAL_CONTACT.email} or through ${LEGAL_CONTACT.website}.`,
    ],
  },
];

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    title: '1. Who we are',
    paragraphs: [
      'This Privacy Policy explains how Never Leave Bros Behind ("NLBB", "we", "us") collects, uses, stores, and protects personal information when you use our mobile app and related services in Kenya.',
      'NLBB acts as the operator of the marketplace platform. Independent service providers are separate businesses and may process your information when you book or communicate with them.',
    ],
  },
  {
    title: '2. Information we collect',
    paragraphs: ['Depending on how you use NLBB, we may collect the following categories of information:'],
    bullets: [
      'Account details: name, email address, phone number, password (stored securely by our authentication provider), profile photo, role, and general location such as city or area.',
      'Booking information: selected provider, service, date, time, status, notes, and history of appointment changes.',
      'Provider business data: business name, description, category, address, opening hours, services, prices, gallery images, and contact numbers including phone, WhatsApp, and M-Pesa details for subscriptions.',
      'Engagement data: saved favorites, reviews, ratings, and in-app notification preferences.',
      'Technical data: device type, app version, log data, and security events needed to operate and protect the service.',
      'Approximate location data: when you search for nearby providers, we may use location information you choose to share or infer general area from addresses you enter.',
    ],
  },
  {
    title: '3. How we use your information',
    paragraphs: ['We use personal information to operate NLBB and deliver the features you request, including:'],
    bullets: [
      'Creating and securing your account.',
      'Showing relevant providers, services, and availability.',
      'Processing bookings and sharing necessary contact details between customer and provider.',
      'Sending booking confirmations, reminders, and account-related notifications.',
      'Managing provider subscriptions and payment status.',
      'Improving app performance, preventing fraud, and enforcing our terms.',
      'Responding to support requests and legal obligations.',
    ],
  },
  {
    title: '4. Legal bases for processing',
    paragraphs: [
      'We process personal information where necessary to perform our contract with you, to pursue legitimate interests such as platform safety and service improvement, to comply with law, and where required, with your consent.',
      'You may withdraw consent for optional features, such as certain notifications, through in-app settings where available.',
    ],
  },
  {
    title: '5. How information is shared',
    paragraphs: ['We do not sell your personal information. We may share information only as needed to run the platform:'],
    bullets: [
      'Between customers and providers when a booking is made or contact is requested.',
      'With infrastructure providers that host authentication, databases, file storage, messaging, and payment processing on our behalf.',
      'With administrators who manage categories, accounts, compliance, and platform operations.',
      'When required by law, court order, or to protect the rights, safety, and security of users and NLBB.',
    ],
  },
  {
    title: '6. Data storage and security',
    paragraphs: [
      'NLBB stores data using secure cloud infrastructure, including Supabase authentication and a PostgreSQL database hosted for production use.',
      'We apply access controls, encrypted transport, and administrative safeguards appropriate to the sensitivity of the data. No online service can guarantee absolute security, but we work to protect information against unauthorised access, loss, or misuse.',
    ],
  },
  {
    title: '7. Data retention',
    paragraphs: [
      'We keep account and booking records for as long as your account is active and for a reasonable period afterward to meet legal, accounting, and dispute-resolution needs.',
      'You may delete your account at any time from Profile → Delete account in the NLBB mobile app. Deletion is permanent and removes your profile, favorites, and associated account data. Some booking or payment records may be retained where required by law.',
      `If you have uninstalled the app, request deletion on the public web page at ${LEGAL_CONTACT.deleteAccountUrl} or email ${LEGAL_CONTACT.email} with the subject "NLBB account deletion request".`,
    ],
  },
  {
    title: '8. Your rights',
    paragraphs: [
      'Under applicable Kenyan data protection law, you may have rights to access, correct, delete, or restrict certain processing of your personal information, and to object to some uses.',
      `Delete your account in the NLBB app under Profile → Delete account, visit ${LEGAL_CONTACT.deleteAccountUrl}, or email ${LEGAL_CONTACT.email}. We may need to verify your identity before fulfilling a request.`,
    ],
  },
  {
    title: '9. Children',
    paragraphs: [
      'NLBB is not intended for users under 18 years of age. We do not knowingly collect personal information from children. If you believe a child has provided us data, please contact us so we can delete it.',
    ],
  },
  {
    title: '10. Third-party links and services',
    paragraphs: [
      'The app may open external links such as maps, phone dialers, WhatsApp, or social profiles operated by providers. Those services have their own privacy practices, and NLBB is not responsible for how third parties handle information outside our platform.',
    ],
  },
  {
    title: '11. International processing',
    paragraphs: [
      'Your information may be processed in Kenya and in other countries where our service providers operate. When data is transferred internationally, we take steps to ensure appropriate safeguards are in place.',
    ],
  },
  {
    title: '12. Changes to this policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. The "Last updated" date in the app will change when we make material updates. Please review this policy periodically.',
    ],
  },
  {
    title: '13. Contact us',
    paragraphs: [
      `If you have questions about this Privacy Policy or how your data is used, contact ${LEGAL_CONTACT.company} at ${LEGAL_CONTACT.email} or visit ${LEGAL_CONTACT.website}.`,
    ],
  },
];

export const DELETE_ACCOUNT_SECTIONS: LegalSection[] = [
  {
    title: 'Request deletion without the app',
    paragraphs: [
      'Never Leave Bros Behind (NLBB) lets you request deletion of your app account and associated personal data even if you have uninstalled the app.',
      `Email ${LEGAL_CONTACT.email} with the subject "NLBB account deletion request" and include the email address on the account. Use the button on this page to open a pre-filled message.`,
    ],
  },
  {
    title: 'Delete from inside the NLBB app',
    paragraphs: [
      'If you still have the app installed, sign in and go to Profile → Delete account. Confirm with your password. This permanently deletes the account.',
    ],
    bullets: [
      'Customers: Profile tab → Delete account',
      'Providers: Profile tab → Delete account',
    ],
  },
  {
    title: 'What we delete',
    paragraphs: ['After we verify the request, we delete:'],
    bullets: [
      'Your login and profile (name, email, phone, photo, preferences)',
      'Saved favorites and notification tokens',
      'Provider business listing, services, and media if you have a provider account',
    ],
  },
  {
    title: 'What we may retain',
    paragraphs: [
      'Some booking or payment records may be kept where required by Kenyan law, accounting, fraud prevention, or dispute resolution. We do not keep your account active after deletion is completed.',
    ],
  },
  {
    title: 'Timing',
    paragraphs: [
      'In-app deletion is immediate after password confirmation. Email requests are processed after we verify that you control the account, usually within 30 days.',
    ],
  },
];
