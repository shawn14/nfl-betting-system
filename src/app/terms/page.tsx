'use client';

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Terms of Service</h1>

      <div className="prose prose-gray text-sm space-y-6">
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Disclaimer</h2>
          <p className="text-gray-600">
            Prediction Matrix provides NFL game predictions and analysis for <strong>informational and entertainment purposes only</strong>.
            Our predictions are generated using statistical models and should not be construed as professional gambling advice.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No Guarantee of Accuracy</h2>
          <p className="text-gray-600">
            While we strive to provide accurate predictions using Elo ratings and statistical analysis, we make no guarantees
            regarding the accuracy, completeness, or reliability of any predictions. Past performance does not guarantee future results.
            Sports outcomes are inherently unpredictable.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Not Gambling Advice</h2>
          <p className="text-gray-600">
            Nothing on this website constitutes gambling advice, investment advice, or a recommendation to place any wager.
            We do not encourage or endorse gambling. If you choose to gamble, do so responsibly and only with money you can afford to lose.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Age Restriction</h2>
          <p className="text-gray-600">
            This website is intended for users who are 21 years of age or older. By using this site, you confirm that you meet
            the legal age requirement in your jurisdiction.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">User Responsibility</h2>
          <p className="text-gray-600">
            You are solely responsible for any decisions you make based on information provided on this website.
            Prediction Matrix and its operators are not liable for any losses, damages, or negative consequences
            resulting from the use of our predictions or any other content on this site.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Gambling Problem Resources</h2>
          <p className="text-gray-600">
            If you or someone you know has a gambling problem, help is available.
            Call the National Problem Gambling Helpline: <strong>1-800-522-4700</strong> (available 24/7).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Changes to Terms</h2>
          <p className="text-gray-600">
            We reserve the right to modify these terms at any time. Continued use of the website constitutes acceptance of any changes.
          </p>
        </section>

        <p className="text-gray-400 text-xs mt-8">Last updated: December 2024</p>
      </div>
    </div>
  );
}
