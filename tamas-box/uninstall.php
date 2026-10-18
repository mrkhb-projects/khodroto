<?php
/**
 * Uninstall routine.
 *
 * Settings are always removed. Chat conversations live in custom tables and
 * are only dropped when the admin enabled
 * "حذف گفتگوها هنگام حذف افزونه" in the live chat tab.
 *
 * @package Tamas_Box
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Remove the chat tables + uploads of one site.
 *
 * @return void
 */
function tmb_uninstall_chat_data() {
	global $wpdb;

	$tables = array(
		$wpdb->prefix . 'tmb_chat_messages',
		$wpdb->prefix . 'tmb_chat_bale_map',
		$wpdb->prefix . 'tmb_chat_sessions',
	);

	foreach ( $tables as $table ) {
		$wpdb->query( "DROP TABLE IF EXISTS {$table}" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
	}

	delete_option( 'tmb_chat_state' );

	$uploads = wp_upload_dir();
	if ( ! empty( $uploads['basedir'] ) ) {
		$dir = trailingslashit( $uploads['basedir'] ) . 'tmb-chat';
		if ( is_dir( $dir ) ) {
			tmb_uninstall_rrmdir( $dir );
		}
	}
}

/**
 * Recursive folder removal.
 *
 * @param string $dir Directory.
 * @return void
 */
function tmb_uninstall_rrmdir( $dir ) {
	$items = @scandir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors

	if ( ! is_array( $items ) ) {
		return;
	}

	foreach ( $items as $item ) {
		if ( '.' === $item || '..' === $item ) {
			continue;
		}

		$path = $dir . DIRECTORY_SEPARATOR . $item;

		if ( is_dir( $path ) ) {
			tmb_uninstall_rrmdir( $path );
		} else {
			@unlink( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
		}
	}

	@rmdir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
}

$tmb_settings   = get_option( 'tmb_settings', array() );
$tmb_drop_chats = ( is_array( $tmb_settings ) && ! empty( $tmb_settings['chat']['delete_on_uninstall'] ) );

delete_option( 'tmb_settings' );
delete_option( 'tmb_version' );
delete_option( 'tmb_chat_upgrade_notice' );

if ( $tmb_drop_chats ) {
	tmb_uninstall_chat_data();
}

// Multisite cleanup.
if ( is_multisite() ) {
	global $wpdb;

	$blog_ids = $wpdb->get_col( "SELECT blog_id FROM {$wpdb->blogs}" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

	foreach ( $blog_ids as $blog_id ) {
		switch_to_blog( $blog_id );

		$tmb_blog_settings = get_option( 'tmb_settings', array() );

		delete_option( 'tmb_settings' );
		delete_option( 'tmb_version' );
		delete_option( 'tmb_chat_upgrade_notice' );

		if ( $tmb_drop_chats || ( is_array( $tmb_blog_settings ) && ! empty( $tmb_blog_settings['chat']['delete_on_uninstall'] ) ) ) {
			tmb_uninstall_chat_data();
		}

		restore_current_blog();
	}
}
