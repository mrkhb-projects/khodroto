<?php
/**
 * Plugin Name:       تماس باکس | Tamas Box
 * Plugin URI:        https://www.mrkhodabakhshi.ir
 * Description:       افزونه دکمه شناور تماس و باکس راه‌های ارتباطی، به‌همراه چت آنلاین سایت که پیام‌های مشتری را به بازوی بله می‌برد و پاسخ مدیران را در همان چت‌باکس نمایش می‌دهد. در دسکتاپ از سمت راست باز می‌شود و در موبایل به صورت منوی کشویی از پایین. کاملاً قابل شخصی‌سازی (رنگ‌بندی، آیتم‌ها، آیکون‌ها، تماس مستقیم tel:) با کنترل کامل نمایش در صفحات دلخواه.
 * Version:           3.2.1
 * Author:            محمدرضا خدابخشی
 * Author URI:        https://www.mrkhodabakhshi.ir
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       tamas-box
 * Domain Path:       /languages
 * Requires at least: 5.4
 * Requires PHP:      7.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'TMB_VERSION', '3.2.1' );
define( 'TMB_FILE', __FILE__ );
define( 'TMB_PATH', plugin_dir_path( __FILE__ ) );
define( 'TMB_URL', plugin_dir_url( __FILE__ ) );
define( 'TMB_OPTION', 'tmb_settings' );
define( 'TMB_AUTHOR', 'محمدرضا خدابخشی' );
define( 'TMB_AUTHOR_URL', 'https://www.mrkhodabakhshi.ir' );

require_once TMB_PATH . 'includes/class-tmb-icons.php';
require_once TMB_PATH . 'includes/class-tmb-settings.php';
require_once TMB_PATH . 'includes/class-tmb-visibility.php';
require_once TMB_PATH . 'includes/class-tmb-chat-db.php';
require_once TMB_PATH . 'includes/class-tmb-chat-bale.php';
require_once TMB_PATH . 'includes/class-tmb-chat.php';
require_once TMB_PATH . 'includes/class-tmb-chat-admin.php';
require_once TMB_PATH . 'includes/class-tmb-admin.php';
require_once TMB_PATH . 'includes/class-tmb-frontend.php';

/**
 * Bootstrap.
 */
function tmb_init() {
	load_plugin_textdomain( 'tamas-box', false, dirname( plugin_basename( TMB_FILE ) ) . '/languages' );

	// Runs the one time upgrade routine (3.2.0 adds the live chat module).
	TMB_Settings::maybe_upgrade();

	if ( is_admin() ) {
		new TMB_Admin();
		TMB_Chat_Admin::instance();
	}

	new TMB_Frontend();
	tmb_chat();
}
add_action( 'plugins_loaded', 'tmb_init' );

/**
 * Activation: seed default settings once.
 */
function tmb_activate() {
	if ( false === get_option( TMB_OPTION ) ) {
		add_option( TMB_OPTION, TMB_Settings::defaults() );
	}

	update_option( 'tmb_version', TMB_VERSION );

	// Live chat tables (safe to re-run, uses dbDelta).
	TMB_Chat_DB::install( true );

	tmb_chat()->cron_setup();
}
register_activation_hook( __FILE__, 'tmb_activate' );

/**
 * Deactivation: stop the cron job.
 */
function tmb_deactivate() {
	TMB_Chat::clear_cron();
}
register_deactivation_hook( __FILE__, 'tmb_deactivate' );

/**
 * Settings link on plugins list.
 *
 * @param array $links Action links.
 * @return array
 */
function tmb_action_links( $links ) {
	$url = admin_url( 'admin.php?page=tamas-box' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'تنظیمات', 'tamas-box' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'tmb_action_links' );

/**
 * Author credit row on plugins list.
 *
 * @param array  $links Meta links.
 * @param string $file  Plugin file.
 * @return array
 */
function tmb_row_meta( $links, $file ) {
	if ( plugin_basename( __FILE__ ) === $file ) {
		$links[] = '<a href="' . esc_url( TMB_AUTHOR_URL ) . '" target="_blank" rel="noopener">' . esc_html__( 'وب‌سایت سازنده', 'tamas-box' ) . '</a>';
	}
	return $links;
}
add_filter( 'plugin_row_meta', 'tmb_row_meta', 10, 2 );
