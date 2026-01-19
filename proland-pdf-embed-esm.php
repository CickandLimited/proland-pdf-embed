<?php
/**
 * Plugin Name: ProLand PDF Embed (PDF.js ESM, No Toolbar)
 * Description: Embed PDFs using PDF.js (ESM build) without cluttered viewer controls, preserving clickable links.
 * Version: 1.0.0
 * Author: Kris Rabai - Veritium Support Services Ltd
 */

if (!defined('ABSPATH')) exit;

class ProLand_PDF_Embed_ESM {
    const HANDLE = 'proland-pdf-embed-esm';

    public function __construct() {
        add_shortcode('proland_pdf', [$this, 'shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    public function register_assets() {
        // Register (don’t enqueue globally)
        wp_register_script(
            self::HANDLE,
            plugin_dir_url(__FILE__) . 'assets/js/pdf-embed.mjs',
            [],
            '1.0.0',
            true
        );

        // Ensure WP prints as <script type="module">
        add_filter('script_loader_tag', function($tag, $handle, $src) {
            if ($handle === self::HANDLE) {
                return '<script type="module" src="' . esc_url($src) . '"></script>';
            }
            return $tag;
        }, 10, 3);

        // Pass paths into the module
        wp_localize_script(self::HANDLE, 'ProLandPdfEmbedESM', [
            'pdfjsDisplaySrc' => plugin_dir_url(__FILE__) . 'assets/pdfjs/build/pdf.mjs',
            'pdfjsWorkerSrc'  => plugin_dir_url(__FILE__) . 'assets/pdfjs/build/pdf.worker.mjs',
            'defaultMaxWidth' => 1100,
            'defaultPadding'  => 16
        ]);
    }

    public function shortcode($atts) {
        $atts = shortcode_atts([
            'url'       => '',
            'max_width' => '1100',
            'padding'   => '16',
            'class'     => ''
        ], $atts, 'proland_pdf');

        $url = esc_url_raw($atts['url']);
        if (empty($url)) {
            return '<div style="padding:12px;border:1px solid #ddd;background:#fff;">
                Missing PDF URL. Use: <code>[proland_pdf url="https://.../file.pdf"]</code>
            </div>';
        }

        // Enqueue the module script only when shortcode is used
        wp_enqueue_script(self::HANDLE);

        $id = 'proland-pdf-' . wp_generate_uuid4();

        $max_width = intval($atts['max_width']);
        if ($max_width <= 0) $max_width = 1100;

        $padding = intval($atts['padding']);
        if ($padding < 0) $padding = 0;

        $class = preg_replace('/[^a-zA-Z0-9_-]/', '', $atts['class']);

        ob_start(); ?>
        <div
            id="<?php echo esc_attr($id); ?>"
            class="proland-pdf-embed <?php echo esc_attr($class); ?>"
            data-pdf-url="<?php echo esc_attr($url); ?>"
            data-max-width="<?php echo esc_attr($max_width); ?>"
            data-padding="<?php echo esc_attr($padding); ?>"
            style="max-width:<?php echo esc_attr($max_width); ?>px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;"
        >
            <div class="proland-pdf-pages" style="background:#fff;padding:<?php echo esc_attr($padding); ?>px;">
                <div class="proland-pdf-status" style="padding:12px;border:1px solid #eee;border-radius:10px;">
                    Loading document…
                </div>
            </div>
            <noscript>
                <div style="padding:12px;">
                    This PDF requires JavaScript. <a href="<?php echo esc_url($url); ?>">Open the PDF</a>.
                </div>
            </noscript>
        </div>
        <?php
        return ob_get_clean();
    }
}

new ProLand_PDF_Embed_ESM();
