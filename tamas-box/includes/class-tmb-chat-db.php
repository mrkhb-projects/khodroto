<?php
/**
 * Chat storage layer (custom tables).
 *
 * Three tables are used:
 *   {prefix}tmb_chat_sessions  one row per visitor conversation
 *   {prefix}tmb_chat_messages  every message (visitor / agent / system)
 *   {prefix}tmb_chat_bale_map  maps a Bale message id back to a session so an
 *                              admin can simply "reply" inside Bale.
 *
 * All timestamps are stored as unix timestamps (UTC based) to avoid any
 * timezone ambiguity between MySQL, WordPress and JavaScript.
 *
 * @package Tamas_Box
 * @since   3.2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Chat_DB {

	const DB_VERSION = '1.0.0';

	const STATE_OPTION = 'tmb_chat_state';

	/**
	 * Runtime guard so the schema check happens once per request.
	 *
	 * @var bool
	 */
	protected static $checked = false;

	/* ---------------------------------------------------------------------
	 * Table names
	 * ------------------------------------------------------------------ */

	/**
	 * Sessions table.
	 *
	 * @return string
	 */
	public static function sessions_table() {
		global $wpdb;
		return $wpdb->prefix . 'tmb_chat_sessions';
	}

	/**
	 * Messages table.
	 *
	 * @return string
	 */
	public static function messages_table() {
		global $wpdb;
		return $wpdb->prefix . 'tmb_chat_messages';
	}

	/**
	 * Bale routing map table.
	 *
	 * @return string
	 */
	public static function map_table() {
		global $wpdb;
		return $wpdb->prefix . 'tmb_chat_bale_map';
	}

	/* ---------------------------------------------------------------------
	 * Install / upgrade
	 * ------------------------------------------------------------------ */

	/**
	 * Create or upgrade the tables (safe to call many times).
	 *
	 * @param bool $force Run dbDelta even when the stored version matches.
	 * @return void
	 */
	public static function install( $force = false ) {
		$state   = self::state();
		$version = isset( $state['db_version'] ) ? $state['db_version'] : '';

		if ( ! $force && self::DB_VERSION === $version && self::tables_exist() ) {
			return;
		}

		self::delta();

		$state['db_version'] = self::DB_VERSION;
		self::save_state( $state );
	}

	/**
	 * Cheap "do the tables exist?" probe used on every request.
	 *
	 * @return bool
	 */
	public static function tables_exist() {
		global $wpdb;

		$table = self::sessions_table();
		$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

		return $found === $table;
	}

	/**
	 * Make sure the schema is present before anything touches the tables.
	 *
	 * Called lazily (on the first chat request of a page load) so a plugin
	 * update that is never re-activated still self-heals.
	 *
	 * @return bool True when the tables are usable.
	 */
	public static function maybe_install() {
		if ( self::$checked ) {
			return true;
		}

		self::$checked = true;

		if ( self::tables_exist() ) {
			$state = self::state();
			if ( ! isset( $state['db_version'] ) || self::DB_VERSION !== $state['db_version'] ) {
				self::install( true );
			}
			return true;
		}

		self::install( true );

		return self::tables_exist();
	}

	/**
	 * Run dbDelta for the three tables.
	 *
	 * @return void
	 */
	protected static function delta() {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();

		$sessions = self::sessions_table();
		$messages = self::messages_table();
		$map      = self::map_table();

		$sql = array();

		$sql[] = "CREATE TABLE {$sessions} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			token CHAR(40) NOT NULL DEFAULT '',
			user_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			name VARCHAR(120) NOT NULL DEFAULT '',
			contact VARCHAR(160) NOT NULL DEFAULT '',
			status VARCHAR(20) NOT NULL DEFAULT 'open',
			page_url TEXT NULL,
			referrer TEXT NULL,
			ip VARCHAR(64) NOT NULL DEFAULT '',
			agent_name VARCHAR(80) NOT NULL DEFAULT '',
			unread_visitor INT(11) UNSIGNED NOT NULL DEFAULT 0,
			unread_agent INT(11) UNSIGNED NOT NULL DEFAULT 0,
			visitor_count INT(11) UNSIGNED NOT NULL DEFAULT 0,
			agent_count INT(11) UNSIGNED NOT NULL DEFAULT 0,
			last_message VARCHAR(255) NOT NULL DEFAULT '',
			last_sender VARCHAR(20) NOT NULL DEFAULT '',
			last_at BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			closed_at BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			created_at BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			updated_at BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			UNIQUE KEY token (token),
			KEY user_id (user_id),
			KEY status_last (status,last_at),
			KEY last_at (last_at)
		) {$charset};";

		$sql[] = "CREATE TABLE {$messages} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			session_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			sender VARCHAR(20) NOT NULL DEFAULT 'visitor',
			origin VARCHAR(20) NOT NULL DEFAULT 'site',
			body LONGTEXT NULL,
			attachment TEXT NULL,
			agent_name VARCHAR(80) NOT NULL DEFAULT '',
			bale_chat_id BIGINT(20) NOT NULL DEFAULT 0,
			bale_message_id BIGINT(20) NOT NULL DEFAULT 0,
			status VARCHAR(20) NOT NULL DEFAULT 'sent',
			created_at BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY session_id (session_id),
			KEY created_at (created_at),
			KEY bale_route (bale_chat_id,bale_message_id)
		) {$charset};";

		$sql[] = "CREATE TABLE {$map} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			bale_chat_id BIGINT(20) NOT NULL DEFAULT 0,
			bale_message_id BIGINT(20) NOT NULL DEFAULT 0,
			session_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			created_at BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			UNIQUE KEY route (bale_chat_id,bale_message_id),
			KEY session_id (session_id)
		) {$charset};";

		foreach ( $sql as $statement ) {
			dbDelta( $statement );
		}
	}

	/**
	 * Drop every chat table (uninstall).
	 *
	 * @return void
	 */
	public static function drop() {
		global $wpdb;

		$tables = array( self::messages_table(), self::map_table(), self::sessions_table() );
		foreach ( $tables as $table ) {
			$wpdb->query( "DROP TABLE IF EXISTS {$table}" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		}

		delete_option( self::STATE_OPTION );
	}

	/* ---------------------------------------------------------------------
	 * Plugin state (db version, polling offset, bot identity ...)
	 * ------------------------------------------------------------------ */

	/**
	 * Read the internal state array.
	 *
	 * @return array
	 */
	public static function state() {
		$state = get_option( self::STATE_OPTION, array() );
		return is_array( $state ) ? $state : array();
	}

	/**
	 * Persist the internal state array.
	 *
	 * @param array $state State.
	 * @return void
	 */
	public static function save_state( $state ) {
		update_option( self::STATE_OPTION, $state, false );
	}

	/**
	 * Update a single state key.
	 *
	 * @param string $key   Key.
	 * @param mixed  $value Value.
	 * @return void
	 */
	public static function set_state( $key, $value ) {
		$state         = self::state();
		$state[ $key ] = $value;
		self::save_state( $state );
	}

	/**
	 * Read a single state key.
	 *
	 * @param string $key      Key.
	 * @param mixed  $fallback Fallback.
	 * @return mixed
	 */
	public static function get_state( $key, $fallback = null ) {
		$state = self::state();
		return isset( $state[ $key ] ) ? $state[ $key ] : $fallback;
	}

	/* ---------------------------------------------------------------------
	 * Sessions
	 * ------------------------------------------------------------------ */

	/**
	 * Insert a session row.
	 *
	 * @param array $data Session fields.
	 * @return int Session id (0 on failure).
	 */
	public static function create_session( $data ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return 0;
		}

		$now = time();

		$row = array(
			'token'          => isset( $data['token'] ) ? $data['token'] : '',
			'user_id'        => isset( $data['user_id'] ) ? absint( $data['user_id'] ) : 0,
			'name'           => isset( $data['name'] ) ? $data['name'] : '',
			'contact'        => isset( $data['contact'] ) ? $data['contact'] : '',
			'status'         => isset( $data['status'] ) ? $data['status'] : 'open',
			'page_url'       => isset( $data['page_url'] ) ? $data['page_url'] : '',
			'referrer'       => isset( $data['referrer'] ) ? $data['referrer'] : '',
			'ip'             => isset( $data['ip'] ) ? $data['ip'] : '',
			'created_at'     => $now,
			'updated_at'     => $now,
			'last_at'        => $now,
		);

		$formats = array( '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%d' );

		$ok = $wpdb->insert( self::sessions_table(), $row, $formats ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

		return $ok ? (int) $wpdb->insert_id : 0;
	}

	/**
	 * Fetch one session.
	 *
	 * @param int $id Session id.
	 * @return array|null
	 */
	public static function get_session( $id ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return null;
		}

		$table = self::sessions_table();
		$row   = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id = %d", absint( $id ) ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL

		return $row ? $row : null;
	}

	/**
	 * Fetch one session by its public token.
	 *
	 * @param string $token Token.
	 * @return array|null
	 */
	public static function get_session_by_token( $token ) {
		global $wpdb;

		$token = self::clean_token( $token );
		if ( '' === $token || ! self::maybe_install() ) {
			return null;
		}

		$table = self::sessions_table();
		$row   = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE token = %s", $token ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL

		return $row ? $row : null;
	}

	/**
	 * Newest open session of a logged in user.
	 *
	 * @param int $user_id User id.
	 * @return array|null
	 */
	public static function get_session_by_user( $user_id ) {
		global $wpdb;

		$user_id = absint( $user_id );
		if ( ! $user_id || ! self::maybe_install() ) {
			return null;
		}

		$table = self::sessions_table();
		$row   = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$wpdb->prepare( "SELECT * FROM {$table} WHERE user_id = %d ORDER BY last_at DESC LIMIT 1", $user_id ),
			ARRAY_A
		);

		return $row ? $row : null;
	}

	/**
	 * Update selected fields of a session.
	 *
	 * @param int   $id   Session id.
	 * @param array $data Fields to change.
	 * @return bool
	 */
	public static function update_session( $id, $data ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return false;
		}

		$allowed = array(
			'token'          => '%s',
			'user_id'        => '%d',
			'name'           => '%s',
			'contact'        => '%s',
			'status'         => '%s',
			'page_url'       => '%s',
			'referrer'       => '%s',
			'ip'             => '%s',
			'agent_name'     => '%s',
			'unread_visitor' => '%d',
			'unread_agent'   => '%d',
			'visitor_count'  => '%d',
			'agent_count'    => '%d',
			'last_message'   => '%s',
			'last_sender'    => '%s',
			'last_at'        => '%d',
			'closed_at'      => '%d',
			'created_at'     => '%d',
			'updated_at'     => '%d',
		);

		$row     = array();
		$formats = array();

		foreach ( $data as $key => $value ) {
			if ( ! isset( $allowed[ $key ] ) ) {
				continue;
			}
			$row[ $key ] = $value;
			$formats[]   = $allowed[ $key ];
		}

		if ( empty( $row ) ) {
			return false;
		}

		$row['updated_at'] = time();
		$formats[]         = '%d';

		$done = $wpdb->update( self::sessions_table(), $row, array( 'id' => absint( $id ) ), $formats, array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

		return false !== $done;
	}

	/**
	 * Delete a session together with its messages and Bale routes.
	 *
	 * @param int $id Session id.
	 * @return bool
	 */
	public static function delete_session( $id ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return false;
		}

		$id       = absint( $id );
		$sessions = self::sessions_table();
		$messages = self::messages_table();
		$map      = self::map_table();

		self::delete_attachments( $id );

		$wpdb->query( $wpdb->prepare( "DELETE FROM {$messages} WHERE session_id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$map} WHERE session_id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$sessions} WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL

		return true;
	}

	/**
	 * Sessions list for the admin inbox.
	 *
	 * @param array $args status, search, page, per_page, orderby.
	 * @return array { items, total, pages }
	 */
	public static function sessions_list( $args = array() ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return array(
				'items' => array(),
				'total' => 0,
				'pages' => 0,
			);
		}

		$args = wp_parse_args(
			$args,
			array(
				'status'   => '',
				'search'   => '',
				'page'     => 1,
				'per_page' => 25,
				'unread'   => false,
			)
		);

		$table    = self::sessions_table();
		$where    = array( '1=1' );
		$prepared = array();

		if ( '' !== $args['status'] && in_array( $args['status'], array( 'open', 'closed' ), true ) ) {
			$where[]    = 'status = %s';
			$prepared[] = $args['status'];
		}

		if ( ! empty( $args['unread'] ) ) {
			$where[] = 'unread_agent > 0';
		}

		if ( '' !== trim( (string) $args['search'] ) ) {
			$like       = '%' . $wpdb->esc_like( trim( (string) $args['search'] ) ) . '%';
			$where[]    = '(name LIKE %s OR contact LIKE %s OR last_message LIKE %s OR ip LIKE %s)';
			$prepared[] = $like;
			$prepared[] = $like;
			$prepared[] = $like;
			$prepared[] = $like;
		}

		$per_page = max( 1, min( 100, (int) $args['per_page'] ) );
		$page     = max( 1, (int) $args['page'] );
		$offset   = ( $page - 1 ) * $per_page;

		$where_sql = implode( ' AND ', $where );

		$count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
		$list_sql  = "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY last_at DESC, id DESC LIMIT {$per_page} OFFSET {$offset}";

		if ( $prepared ) {
			$total = (int) $wpdb->get_var( $wpdb->prepare( $count_sql, $prepared ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$items = $wpdb->get_results( $wpdb->prepare( $list_sql, $prepared ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		} else {
			$total = (int) $wpdb->get_var( $count_sql ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$items = $wpdb->get_results( $list_sql, ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		}

		return array(
			'items' => $items ? $items : array(),
			'total' => $total,
			'pages' => (int) ceil( $total / $per_page ),
		);
	}

	/**
	 * Counter helpers used by the admin menu badge.
	 *
	 * @return array { open, unread }
	 */
	public static function counters() {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return array(
				'open'   => 0,
				'unread' => 0,
			);
		}

		$table = self::sessions_table();

		$open   = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE status = 'open'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		$unread = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE unread_agent > 0" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL

		return array(
			'open'   => $open,
			'unread' => $unread,
		);
	}

	/**
	 * The most recently active open session (used for "plain text" Bale replies).
	 *
	 * @return array|null
	 */
	public static function latest_open_session() {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return null;
		}

		$table = self::sessions_table();
		$row   = $wpdb->get_row( "SELECT * FROM {$table} WHERE status = 'open' ORDER BY last_at DESC, id DESC LIMIT 1", ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL

		return $row ? $row : null;
	}

	/**
	 * Validate / normalise a visitor token.
	 *
	 * @param string $token Raw token.
	 * @return string
	 */
	public static function clean_token( $token ) {
		$token = preg_replace( '/[^a-zA-Z0-9]/', '', (string) $token );
		return substr( (string) $token, 0, 64 );
	}

	/**
	 * Create a fresh visitor token.
	 *
	 * @return string
	 */
	public static function new_token() {
		return strtolower( wp_generate_password( 40, false, false ) );
	}

	/* ---------------------------------------------------------------------
	 * Messages
	 * ------------------------------------------------------------------ */

	/**
	 * Insert one message and keep the session counters in sync.
	 *
	 * @param array $data Message fields.
	 * @return int Message id (0 on failure).
	 */
	public static function add_message( $data ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return 0;
		}

		$session_id = isset( $data['session_id'] ) ? absint( $data['session_id'] ) : 0;
		$session    = $session_id ? self::get_session( $session_id ) : null;

		if ( ! $session ) {
			return 0;
		}

		$sender = isset( $data['sender'] ) ? $data['sender'] : 'visitor';
		if ( ! in_array( $sender, array( 'visitor', 'agent', 'system' ), true ) ) {
			$sender = 'visitor';
		}

		$attachment = '';
		if ( ! empty( $data['attachment'] ) ) {
			$attachment = wp_json_encode( $data['attachment'] );
		}

		$now = isset( $data['created_at'] ) ? absint( $data['created_at'] ) : time();

		$row = array(
			'session_id'      => $session_id,
			'sender'          => $sender,
			'origin'          => isset( $data['origin'] ) ? $data['origin'] : 'site',
			'body'            => isset( $data['body'] ) ? (string) $data['body'] : '',
			'attachment'      => $attachment,
			'agent_name'      => isset( $data['agent_name'] ) ? $data['agent_name'] : '',
			'bale_chat_id'    => isset( $data['bale_chat_id'] ) ? (int) $data['bale_chat_id'] : 0,
			'bale_message_id' => isset( $data['bale_message_id'] ) ? (int) $data['bale_message_id'] : 0,
			'status'          => isset( $data['status'] ) ? $data['status'] : 'sent',
			'created_at'      => $now,
		);

		$ok = $wpdb->insert( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			self::messages_table(),
			$row,
			array( '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%s', '%d' )
		);

		if ( ! $ok ) {
			return 0;
		}

		$message_id = (int) $wpdb->insert_id;

		/* keep session summary fresh */
		$preview = self::preview_text( $row['body'], $attachment );
		$update  = array(
			'last_message' => $preview,
			'last_sender'  => $sender,
			'last_at'      => $now,
		);

		if ( 'visitor' === $sender ) {
			$update['visitor_count'] = (int) $session['visitor_count'] + 1;
			$update['unread_agent']  = (int) $session['unread_agent'] + 1;
		} elseif ( 'agent' === $sender ) {
			$update['agent_count']    = (int) $session['agent_count'] + 1;
			$update['unread_visitor'] = (int) $session['unread_visitor'] + 1;
			if ( '' !== $row['agent_name'] ) {
				$update['agent_name'] = $row['agent_name'];
			}
		} else {
			/* system notices also count as something new for the visitor */
			$update['unread_visitor'] = (int) $session['unread_visitor'] + 1;
		}

		self::update_session( $session_id, $update );

		return $message_id;
	}

	/**
	 * Short one-line preview for the session list.
	 *
	 * @param string $body       Message body.
	 * @param string $attachment Encoded attachment.
	 * @return string
	 */
	protected static function preview_text( $body, $attachment = '' ) {
		$text = trim( (string) $body );

		if ( '' === $text && $attachment ) {
			$data = json_decode( $attachment, true );
			if ( is_array( $data ) && ! empty( $data['type'] ) ) {
				$text = '[' . $data['type'] . ']';
			}
		}

		$text = wp_html_excerpt( $text, 180, '' );

		return $text;
	}

	/**
	 * Messages of a session.
	 *
	 * @param int $session_id Session.
	 * @param int $after      Only rows with id > $after.
	 * @param int $limit      Max rows.
	 * @return array
	 */
	/**
	 * Newest messages across every session (diagnostics).
	 *
	 * @param string $sender '' = all, 'agent', 'visitor', 'system'.
	 * @param int    $limit  Max rows.
	 * @return array
	 */
	public static function recent_messages( $sender = '', $limit = 3 ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return array();
		}

		$table  = self::messages_table();
		$limit  = max( 1, min( 20, (int) $limit ) );
		$sender = (string) $sender;

		if ( '' !== $sender ) {
			$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
				$wpdb->prepare( "SELECT * FROM {$table} WHERE sender = %s ORDER BY id DESC LIMIT {$limit}", $sender ),
				ARRAY_A
			);
		} else {
			$rows = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY id DESC LIMIT {$limit}", ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		}

		return $rows ? $rows : array();
	}

	/**
	 * Message and session totals (diagnostics).
	 *
	 * @return array
	 */
	public static function totals() {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return array( 'messages' => 0, 'agent' => 0, 'visitor' => 0, 'sessions' => 0, 'map' => 0 );
		}

		$messages = self::messages_table();
		$sessions = self::sessions_table();

		$by_sender = $wpdb->get_results( "SELECT sender, COUNT(*) AS n FROM {$messages} GROUP BY sender", ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		$out       = array( 'messages' => 0, 'agent' => 0, 'visitor' => 0, 'sessions' => 0, 'map' => 0 );

		foreach ( (array) $by_sender as $row ) {
			$n               = isset( $row['n'] ) ? (int) $row['n'] : 0;
			$out['messages'] += $n;

			if ( isset( $row['sender'] ) && isset( $out[ $row['sender'] ] ) ) {
				$out[ $row['sender'] ] = $n;
			}
		}

		$out['sessions'] = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$sessions}" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL

		return $out;
	}

	public static function get_messages( $session_id, $after = 0, $limit = 100 ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return array();
		}

		$table      = self::messages_table();
		$session_id = absint( $session_id );
		$after      = absint( $after );
		$limit      = max( 1, min( 200, (int) $limit ) );

		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE session_id = %d AND id > %d ORDER BY id ASC LIMIT {$limit}",
				$session_id,
				$after
			),
			ARRAY_A
		);

		return $rows ? $rows : array();
	}

	/**
	 * Last N messages of a session (newest last).
	 *
	 * @param int $session_id Session.
	 * @param int $limit      Max rows.
	 * @return array
	 */
	public static function last_messages( $session_id, $limit = 40 ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return array();
		}

		$table      = self::messages_table();
		$session_id = absint( $session_id );
		$limit      = max( 1, min( 200, (int) $limit ) );

		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$wpdb->prepare(
				"SELECT * FROM (SELECT * FROM {$table} WHERE session_id = %d ORDER BY id DESC LIMIT {$limit}) AS t ORDER BY t.id ASC",
				$session_id
			),
			ARRAY_A
		);

		return $rows ? $rows : array();
	}

	/**
	 * Reset one of the unread counters.
	 *
	 * @param int    $session_id Session.
	 * @param string $who        'visitor' or 'agent'.
	 * @return void
	 */
	public static function mark_read( $session_id, $who = 'visitor' ) {
		$field = ( 'agent' === $who ) ? 'unread_agent' : 'unread_visitor';
		self::update_session( absint( $session_id ), array( $field => 0 ) );
	}

	/**
	 * Remove stored media files of a session.
	 *
	 * @param int $session_id Session.
	 * @return void
	 */
	public static function delete_attachments( $session_id ) {
		$dir = self::uploads_dir( absint( $session_id ), false );

		if ( $dir && is_dir( $dir ) ) {
			$files = glob( trailingslashit( $dir ) . '*' );
			if ( is_array( $files ) ) {
				foreach ( $files as $file ) {
					if ( is_file( $file ) ) {
						@unlink( $file ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
					}
				}
			}
			@rmdir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
	}

	/**
	 * Delete conversations older than N days.
	 *
	 * @param int $days Days to keep.
	 * @return int Number of removed sessions.
	 */
	public static function prune( $days ) {
		global $wpdb;

		$days = (int) $days;
		if ( $days <= 0 || ! self::maybe_install() ) {
			return 0;
		}

		$cut    = time() - ( $days * DAY_IN_SECONDS );
		$table  = self::sessions_table();
		$ids    = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM {$table} WHERE last_at > 0 AND last_at < %d LIMIT 200", $cut ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
		$remove = 0;

		foreach ( (array) $ids as $id ) {
			self::delete_session( (int) $id );
			$remove++;
		}

		return $remove;
	}

	/* ---------------------------------------------------------------------
	 * Bale routing map
	 * ------------------------------------------------------------------ */

	/**
	 * Remember which Bale message belongs to which session.
	 *
	 * @param int $chat_id         Bale chat id.
	 * @param int $message_id      Bale message id.
	 * @param int $session_id      Local session.
	 * @return void
	 */
	public static function map_bale_message( $chat_id, $message_id, $session_id ) {
		global $wpdb;

		$chat_id    = (int) $chat_id;
		$message_id = (int) $message_id;
		$session_id = absint( $session_id );

		if ( ! $chat_id || ! $message_id || ! $session_id || ! self::maybe_install() ) {
			return;
		}

		$wpdb->replace( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			self::map_table(),
			array(
				'bale_chat_id'    => $chat_id,
				'bale_message_id' => $message_id,
				'session_id'      => $session_id,
				'created_at'      => time(),
			),
			array( '%d', '%d', '%d', '%d' )
		);
	}

	/**
	 * Resolve a session from a Bale (chat id, message id) pair.
	 *
	 * @param int $chat_id    Bale chat id.
	 * @param int $message_id Bale message id.
	 * @return int Session id (0 when unknown).
	 */
	public static function session_for_bale_message( $chat_id, $message_id ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return 0;
		}

		$table = self::map_table();
		$id    = $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$wpdb->prepare(
				"SELECT session_id FROM {$table} WHERE bale_chat_id = %d AND bale_message_id = %d ORDER BY id DESC LIMIT 1",
				(int) $chat_id,
				(int) $message_id
			)
		);

		return $id ? (int) $id : 0;
	}

	/**
	 * Remove routing rows older than N days (keeps the table small).
	 *
	 * @param int $days Days.
	 * @return void
	 */
	public static function prune_map( $days = 30 ) {
		global $wpdb;

		if ( ! self::maybe_install() ) {
			return;
		}

		$cut   = time() - ( absint( $days ) * DAY_IN_SECONDS );
		$table = self::map_table();

		$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE created_at < %d", $cut ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
	}

	/* ---------------------------------------------------------------------
	 * Uploads
	 * ------------------------------------------------------------------ */

	/**
	 * Directory (and URL) used to store media received from Bale.
	 *
	 * @param int  $session_id Session.
	 * @param bool $create     Create the folder when missing.
	 * @return string|false Absolute path or false.
	 */
	public static function uploads_dir( $session_id, $create = true ) {
		$upload = wp_upload_dir();

		if ( ! empty( $upload['error'] ) ) {
			return false;
		}

		$dir = trailingslashit( $upload['basedir'] ) . 'tmb-chat/' . absint( $session_id );

		if ( $create && ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			if ( ! is_dir( $dir ) ) {
				return false;
			}
			// Block directory listing / PHP execution inside the folder.
			@file_put_contents( trailingslashit( $dir ) . 'index.html', '' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.WP.AlternativeFunctions
		}

		return $dir;
	}

	/**
	 * Public URL of the chat uploads folder.
	 *
	 * @param int $session_id Session.
	 * @return string
	 */
	public static function uploads_url( $session_id ) {
		$upload = wp_upload_dir();
		return trailingslashit( $upload['baseurl'] ) . 'tmb-chat/' . absint( $session_id ) . '/';
	}
}
