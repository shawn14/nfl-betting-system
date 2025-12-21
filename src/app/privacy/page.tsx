'use client';

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Privacy Policy</h1>

      <div className="prose prose-gray text-sm space-y-6">
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Information We Collect</h2>
          <p className="text-gray-600">
            Prediction Matrix does not require user registration or collect personal information.
            We may collect anonymous usage data such as page views and general traffic statistics
            to improve our service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Cookies</h2>
          <p className="text-gray-600">
            We may use cookies and similar technologies to enhance your browsing experience
            and analyze site traffic. You can control cookie settings through your browser.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Third-Party Services</h2>
          <p className="text-gray-600">
            We may use third-party analytics services (such as Vercel Analytics) that collect
            anonymous usage data. These services have their own privacy policies.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Data Security</h2>
          <p className="text-gray-600">
            We take reasonable measures to protect any data collected. However, no internet
            transmission is completely secure.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Changes to This Policy</h2>
          <p className="text-gray-600">
            We may update this privacy policy from time to time. Any changes will be posted on this page.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Contact</h2>
          <p className="text-gray-600">
            If you have questions about this privacy policy, please contact us through our website.
          </p>
        </section>

        <p className="text-gray-400 text-xs mt-8">Last updated: December 2024</p>
      </div>
    </div>
  );
}
